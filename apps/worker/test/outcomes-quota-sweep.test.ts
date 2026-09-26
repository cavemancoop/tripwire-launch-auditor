import { beforeEach, describe, expect, it, vi } from 'vitest';

// Package 4a / F05, resolver → sweep: the real sweepDueOutcomes and the real
// TRADING_ALIVE / SELL_IMPAIRED resolvers, with Postgres stubbed and dispatch
// stubbed only to hand each row its fixture client. A quota outage must leave
// rows PENDING with no value and must not start, advance or trip the give-up
// clock, however long it lasts; healthy grading and non-quota give-ups are unchanged.
type Row = { id: string; label: string; horizon: string; tokenAddress: string; evidence: unknown };
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
  const { resolveSellImpaired } = await import('../src/outcomes/resolve-sell-impaired');
  const { POOL_KEY, resolverCtx } = await import('./fixtures/outcome-quota');
  return {
    resolveOneOutcome: async (_client: unknown, row: Row) => {
      const client = st.clients[row.id] as never;
      if (row.label === 'SELL_IMPAIRED') {
        return resolveSellImpaired(resolverCtx({ client, label: 'SELL_IMPAIRED', poolKey: POOL_KEY }));
      }
      return resolveSurvival(resolverCtx({ client }));
    },
  };
});

const { sweepDueOutcomes } = await import('../src/outcomes/loop');
const { QUOTA_18_SEP, failingClient, logClient, viemRpcError } = await import('./fixtures/outcome-quota');
const { sqrtForPrice, v4SwapLog } = await import('./fixtures/logs');
const { POOL_ID } = await import('./fixtures/outcome-quota');

/** a give-up clock started two days ago: twice the 24h give-up window */
const OLD_CLOCK = new Date(Date.now() - 48 * 3_600_000).toISOString();

const row = (id: string, label: string, evidence: unknown = null): Row => ({
  id,
  label,
  horizon: '24h',
  tokenAddress: `0x${id}`,
  evidence,
});

const updateFor = (id: string): Update['data'] => {
  const u = st.updates.filter((x) => x.where.id === id);
  expect(u).toHaveLength(1);
  return u[0]!.data;
};

beforeEach(() => {
  st.rows = [];
  st.updates = [];
  st.clients = {};
});

describe('sweepDueOutcomes — provider quota (Package 4a)', () => {
  it('quota rows stay PENDING, valueless and never given up; other rows grade as before', async () => {
    st.rows = [
      row('q1', 'TRADING_ALIVE'),
      row('q2', 'TRADING_ALIVE', { firstDeferredAt: OLD_CLOCK, deferrals: 3 }),
      row('h1', 'TRADING_ALIVE'),
      row('u1', 'TRADING_ALIVE'),
      row('t1', 'TRADING_ALIVE', { firstDeferredAt: OLD_CLOCK, deferrals: 5 }),
      row('s1', 'SELL_IMPAIRED', { firstDeferredAt: OLD_CLOCK, deferrals: 2 }),
    ];
    st.clients = {
      q1: failingClient(new Error(QUOTA_18_SEP)),
      q2: failingClient(new Error(QUOTA_18_SEP)),
      h1: logClient([v4SwapLog(POOL_ID, sqrtForPrice(1), 950_000n)]),
      u1: failingClient(new Error('upstream RPC error')),
      t1: failingClient(new Error('fetch failed')),
      s1: failingClient(viemRpcError(QUOTA_18_SEP)),
    };

    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });

    expect(r).toMatchObject({ picked: 6, resolved: 1, na: 0, unresolvable: 2, retryLater: 3, failed: 0 });

    // quota: no status, no value; the clock is neither started (q1) nor reset or tripped (q2, s1)
    for (const id of ['q1', 'q2', 's1']) {
      const d = updateFor(id);
      expect(d.status).toBeUndefined();
      expect('value' in d).toBe(false);
      expect(d.measuredAt).toBeInstanceOf(Date);
    }
    expect(updateFor('q1').evidence).toEqual({ lastError: QUOTA_18_SEP });
    expect(updateFor('q2').evidence).toEqual({ firstDeferredAt: OLD_CLOCK, deferrals: 3, lastError: QUOTA_18_SEP });
    expect(updateFor('s1').evidence).toMatchObject({ firstDeferredAt: OLD_CLOCK, deferrals: 2 });
    expect((updateFor('s1').evidence as { lastError: string }).lastError).toContain('monthly quota');

    // unchanged: a healthy row grades, a row-level failure is UNRESOLVABLE, and a
    // non-quota transient past the give-up window still gives up
    expect(updateFor('h1')).toMatchObject({ status: 'RESOLVED', value: true });
    expect(updateFor('u1')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect(updateFor('t1')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect((updateFor('t1').evidence as { reason: string }).reason).toMatch(/^gave up after 6 transient failures/);
  });

  it('repeated quota sweeps keep the row PENDING with its original clock', async () => {
    let evidence: unknown = { firstDeferredAt: OLD_CLOCK, deferrals: 1 };
    for (let sweep = 0; sweep < 3; sweep++) {
      st.rows = [row('q1', 'TRADING_ALIVE', evidence)];
      st.updates = [];
      st.clients = { q1: failingClient(new Error(QUOTA_18_SEP)) };
      const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });
      expect(r).toMatchObject({ picked: 1, retryLater: 1, unresolvable: 0 });
      const d = updateFor('q1');
      expect(d.status).toBeUndefined();
      evidence = d.evidence;
    }
    expect(evidence).toEqual({ firstDeferredAt: OLD_CLOCK, deferrals: 1, lastError: QUOTA_18_SEP });
  });
});
