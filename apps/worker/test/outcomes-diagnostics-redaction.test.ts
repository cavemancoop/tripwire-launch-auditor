import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Package 4a / review finding d1286de9: viem puts the RPC URL — which carries the
// provider key in its path — into every error message. The sweep persisted and
// logged those messages raw: quota deferrals, ordinary deferrals, terminal
// give-ups (whose evidence GET /v1/launch/:token serves verbatim) and the
// catch-site failure counter. Every one of those sinks must see redacted text,
// while classification still reads the original error.
type Row = { id: string; label: string; horizon: string; tokenAddress: string; evidence: unknown };
type Update = { where: { id: string }; data: Record<string, unknown> };

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  updates: [] as Update[],
  upserts: [] as unknown[],
  clients: {} as Record<string, unknown>,
  /** thrown by dispatch itself, before any resolver: a code-path failure */
  throws: {} as Record<string, unknown>,
}));

vi.mock('@launch-auditor/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    outcome: {
      findMany: async (args: { where: { label?: string }; take: number }) =>
        st.rows.filter((r) => r.label === args.where.label).slice(0, args.take),
      update: async (args: Update) => {
        st.updates.push(args);
        return {};
      },
    },
    catchSiteFailure: {
      upsert: async (args: unknown) => {
        st.upserts.push(args);
        return {};
      },
    },
  },
}));

vi.mock('../src/outcomes/resolve', async () => {
  const { resolveSurvival } = await import('../src/outcomes/resolve-survival');
  const { resolverCtx } = await import('./fixtures/outcome-quota');
  return {
    resolveOneOutcome: async (_client: unknown, row: Row) => {
      if (st.throws[row.id]) throw st.throws[row.id];
      return resolveSurvival(resolverCtx({ client: st.clients[row.id] as never }));
    },
  };
});

// viem's RpcRequestError is transient to the scan's retry, which sleeps ~9s per
// row before rethrowing; one attempt reaches the same sweep error path
vi.mock('../src/watcher/retry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/watcher/retry')>()),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const { sweepDueOutcomes } = await import('../src/outcomes/loop');
const { QUOTA_18_SEP, failingClient, logClient, viemRpcError } = await import('./fixtures/outcome-quota');
const { sqrtForPrice, v4SwapLog } = await import('./fixtures/logs');
const { POOL_ID } = await import('./fixtures/outcome-quota');

const SECRET = 'S3CR3TKEYd00d';
/** Chainstack-shaped endpoint: the key is the path */
const KEYED_URL = `https://nd-123-456-789.p2pify.com/${SECRET}`;
const OLD_CLOCK = new Date(Date.now() - 48 * 3_600_000).toISOString();

const row = (id: string, evidence: unknown = null): Row => ({
  id,
  label: 'TRADING_ALIVE',
  horizon: '24h',
  tokenAddress: `0x${id}`,
  evidence,
});

const updateFor = (id: string): Update['data'] => {
  const u = st.updates.filter((x) => x.where.id === id);
  expect(u).toHaveLength(1);
  return u[0]!.data;
};

let logged: string[] = [];

beforeEach(() => {
  st.rows = [];
  st.updates = [];
  st.upserts = [];
  st.clients = {};
  st.throws = {};
  logged = [];
  const capture = (...args: unknown[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  };
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  // recordFailure skips its write under vitest; this suite must exercise it
  vi.stubEnv('VITEST', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sweepDueOutcomes — credential-bearing RPC errors are redacted at every sink', () => {
  it('quota, deferral, give-up and generic-failure paths persist and log no key or URL', async () => {
    st.rows = [
      row('quota'),
      row('fresh'),
      row('old', { firstDeferredAt: OLD_CLOCK, deferrals: 4 }),
      row('timedout'),
      row('bug'),
      row('healthy'),
    ];
    st.clients = {
      quota: failingClient(viemRpcError(QUOTA_18_SEP, KEYED_URL)),
      fresh: failingClient(viemRpcError('fetch failed', KEYED_URL)),
      old: failingClient(viemRpcError('fetch failed', KEYED_URL)),
      // review 896555be: transport by the shared taxonomy, so the sweep defers it
      // (it used to fall outside the loop's own pattern and count as a code failure)
      timedout: failingClient(viemRpcError('request timed out', KEYED_URL)),
      healthy: logClient([v4SwapLog(POOL_ID, sqrtForPrice(1), 950_000n)]),
    };
    st.throws = { bug: new Error(`unexpected response shape from ${KEYED_URL}`) };

    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });

    // classification and grading are unchanged by redaction
    expect(r).toMatchObject({ picked: 6, resolved: 1, unresolvable: 1, retryLater: 3, failed: 1 });
    expect(updateFor('healthy')).toMatchObject({ status: 'RESOLVED', value: true });
    expect(updateFor('quota').status).toBeUndefined();
    expect(updateFor('quota').evidence).not.toHaveProperty('deferrals');
    expect(updateFor('fresh').evidence).toMatchObject({ deferrals: 1 });
    expect(updateFor('timedout').status).toBeUndefined();
    expect(updateFor('timedout').evidence).toMatchObject({ deferrals: 1 });
    expect(updateFor('old')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect(updateFor('bug')).toEqual({ measuredAt: expect.any(Date) });

    // the diagnostics stay useful: the provider's own text survives redaction
    expect((updateFor('quota').evidence as { lastError: string }).lastError).toContain('monthly quota');
    expect((updateFor('fresh').evidence as { lastError: string }).lastError).toContain('fetch failed');
    expect((updateFor('timedout').evidence as { lastError: string }).lastError).toContain('request timed out');
    expect((updateFor('old').evidence as { reason: string }).reason).toMatch(/^gave up after 5 transient failures .*fetch failed/s);

    // the failure counter was actually written (not skipped) for the generic path
    expect(st.upserts).toHaveLength(1);
    expect(st.upserts[0]).toMatchObject({ where: { site: 'outcomes.resolve_failed' } });
    expect(JSON.stringify(st.upserts)).toContain('unexpected response shape');

    // no sink carries the key or any URL. Outcome evidence is what
    // GET /v1/launch/:token serves verbatim (apps/api/src/launch-detail.ts).
    const sinks = { updates: JSON.stringify(st.updates), logs: logged.join('\n'), failures: JSON.stringify(st.upserts) };
    expect(logged.length).toBeGreaterThanOrEqual(5);
    for (const [name, text] of Object.entries(sinks)) {
      expect(text, name).not.toContain(SECRET);
      expect(text, name).not.toMatch(/\b(?:https?|wss?):\/\//i);
    }
  });

  it('a row-level UNRESOLVABLE reason is redacted too', async () => {
    st.rows = [row('archive')];
    // not a provider failure: resolveSurvival writes its first line as the reason
    st.clients = { archive: failingClient(new Error(`missing trie node at ${KEYED_URL}`)) };

    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });

    expect(r).toMatchObject({ picked: 1, unresolvable: 1 });
    const d = updateFor('archive');
    expect(d.status).toBe('UNRESOLVABLE');
    expect((d.evidence as { reason: string }).reason).toContain('missing trie node');
    expect(JSON.stringify(d)).not.toContain(SECRET);
  });
});
