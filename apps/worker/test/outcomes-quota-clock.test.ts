import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Package 4a / review 896555be: a quota outage kept rows PENDING but its hours
// still counted toward the 24h give-up clock, so a transient failure at hour 0,
// quota refusals through hour 49 and a fetch failure at hour 50 turned the row
// UNRESOLVABLE. The real sweepDueOutcomes and the real TRADING_ALIVE resolver run
// on a fake clock; each sweep reloads the evidence and backoff stamp the last one
// persisted, as the next Postgres read would.
type Row = {
  id: string;
  label: string;
  horizon: string;
  tokenAddress: string;
  evidence: unknown;
  measuredAt: Date | null;
};
type Update = { where: { id: string }; data: Record<string, unknown> };

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  updates: [] as Update[],
  clients: {} as Record<string, unknown>,
}));

vi.mock('@launch-auditor/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    $transaction: async function (fn: (tx: unknown) => Promise<unknown>) {
      return fn({ outcome: this.outcome, $queryRaw: async () => [{ dbNow: new Date() }] });
    },
    outcome: {
      findMany: async (args: { where: { label?: string }; take: number }) =>
        st.rows.filter((r) => r.label === args.where.label).slice(0, args.take),
      // Package 4b: every claim succeeds; the owner-guarded writes are the row's result
      updateMany: async (args: Update) => {
        if (typeof args.data.claimToken !== 'string') st.updates.push(args);
        return { count: 1 };
      },
    },
  },
}));

vi.mock('../src/outcomes/resolve', async () => {
  const { resolveSurvival } = await import('../src/outcomes/resolve-survival');
  const { resolverCtx } = await import('./fixtures/outcome-quota');
  return {
    resolveOneOutcome: async (_client: unknown, row: Row) =>
      resolveSurvival(resolverCtx({ client: st.clients[row.id] as never })),
  };
});

// one scan attempt reaches the same sweep path without the retry's real sleeps
vi.mock('../src/watcher/retry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/watcher/retry')>()),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const { sweepDueOutcomes } = await import('../src/outcomes/loop');
const { QUOTA_18_SEP, failingClient, viemRpcError } = await import('./fixtures/outcome-quota');

const H = 3_600_000;
const T0 = Date.parse('2026-09-18T00:00:00Z');

type Outcome = 'fetch' | 'quota' | 'quota429';
const errorFor = (o: Outcome): Error =>
  o === 'fetch'
    ? new Error('fetch failed')
    : o === 'quota'
      ? new Error(QUOTA_18_SEP)
      : // Chainstack delivers plan exhaustion as an HTTP 429 through viem
        viemRpcError(`HTTP 429 Too Many Requests: ${QUOTA_18_SEP}`);

/** one row, swept at each `[hour, failure]`; returns every persisted update in order */
async function run(schedule: Array<[number, Outcome]>) {
  let row: Row = { id: 'r1', label: 'TRADING_ALIVE', horizon: '24h', tokenAddress: '0xr1', evidence: null, measuredAt: null };
  const steps: Array<{ hour: number; data: Update['data']; r: Awaited<ReturnType<typeof sweepDueOutcomes>> }> = [];
  for (const [hour, o] of schedule) {
    vi.setSystemTime(T0 + hour * H);
    st.rows = [row];
    st.updates = [];
    st.clients = { r1: failingClient(errorFor(o)) };
    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });
    expect(st.updates).toHaveLength(1);
    const data = st.updates[0]!.data;
    steps.push({ hour, data, r });
    if (data.status !== undefined) break;
    row = { ...row, evidence: data.evidence, measuredAt: data.measuredAt as Date };
  }
  return steps;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  st.rows = [];
  st.updates = [];
  st.clients = {};
});

afterEach(() => {
  vi.useRealTimers();
});

const hours = (from: number, to: number, o: Outcome): Array<[number, Outcome]> =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, o]);

describe('give-up clock across a quota outage (review 896555be)', () => {
  it('hour 0 transient, quota through hour 49, transient at hour 50: stays PENDING', async () => {
    const steps = await run([[0, 'fetch'], ...hours(1, 49, 'quota'), [50, 'fetch']]);
    expect(steps).toHaveLength(51);
    for (const s of steps) {
      expect(s.data.status).toBeUndefined();
      expect('value' in s.data).toBe(false);
      expect(s.r).toMatchObject({ picked: 1, retryLater: 1, unresolvable: 0 });
    }
    const last = steps.at(-1)!;
    // the clock keeps its start and deferral count; the outage is a recorded pause
    expect(last.data.evidence).toMatchObject({
      firstDeferredAt: new Date(T0).toISOString(),
      deferrals: 2,
      quotaPausedMs: 49 * H,
    });
    expect(last.data.measuredAt).toEqual(new Date(T0 + 50 * H));
  });

  it('retry time counted before and after the outage is kept: gives up once it reaches 24h', async () => {
    // counted: hour 0→1 is charged to the outage, hours 49→73 are retry time
    const steps = await run([[0, 'fetch'], ...hours(1, 49, 'quota'), ...hours(50, 73, 'fetch')]);
    const beforeLast = steps.at(-2)!;
    expect(beforeLast.hour).toBe(72);
    expect(beforeLast.data.status).toBeUndefined();
    const last = steps.at(-1)!;
    expect(last.hour).toBe(73);
    expect(last.data).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect(last.data.evidence).toMatchObject({ deferrals: 25, quotaPausedMs: 49 * H });
    expect((last.data.evidence as { reason: string }).reason).toMatch(/^gave up after 25 transient failures since /);
  });

  it('quota delivered as a viem HTTP 429 pauses the clock the same way', async () => {
    const steps = await run([[0, 'fetch'], ...hours(1, 49, 'quota429'), [50, 'fetch']]);
    const last = steps.at(-1)!;
    expect(last.data.status).toBeUndefined();
    expect(last.data.evidence).toMatchObject({ deferrals: 2, quotaPausedMs: 49 * H });
    expect(JSON.stringify(steps.map((s) => s.data.evidence))).not.toContain('https://');
  });

  it('control, no outage: the established 24h give-up is unchanged', async () => {
    const steps = await run(hours(0, 30, 'fetch'));
    expect(steps).toHaveLength(25);
    for (const s of steps.slice(0, 24)) expect(s.data.status).toBeUndefined();
    const last = steps.at(-1)!;
    expect(last.hour).toBe(24);
    expect(last.data).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect(last.data.evidence).not.toHaveProperty('quotaPausedMs');
  });

  it('an outage before any transient failure starts no clock and records no pause', async () => {
    const steps = await run([...hours(0, 48, 'quota'), [49, 'fetch']]);
    for (const s of steps.slice(0, 49)) {
      expect(s.data.evidence).toEqual({ lastError: QUOTA_18_SEP });
    }
    expect(steps.at(-1)!.data.evidence).toMatchObject({
      firstDeferredAt: new Date(T0 + 49 * H).toISOString(),
      deferrals: 1,
    });
    expect(steps.at(-1)!.data.evidence).not.toHaveProperty('quotaPausedMs');
  });
});
