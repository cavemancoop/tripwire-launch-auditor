import { beforeEach, describe, expect, it, vi } from 'vitest';

// Package 2b: the real sweepDueOutcomes with Postgres and the resolvers stubbed,
// so the per-label pick split and the row-result counts it reports can be
// checked against what it actually selected and wrote.
const db = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; label: string; horizon: string; tokenAddress: string; evidence: unknown }>,
  findMany: [] as unknown[],
  updates: [] as Array<{ where: { id: string }; data: { status?: string; claimToken?: string | null } }>,
}));
vi.mock('@launch-auditor/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    $transaction: async function (fn: (tx: unknown) => Promise<unknown>) {
      return fn({ outcome: this.outcome, $queryRaw: async () => [{ dbNow: new Date() }] });
    },
    outcome: {
      findMany: async (args: { where: { label?: string }; take: number }) => {
        db.findMany.push(args);
        return db.rows.filter((r) => r.label === args.where.label).slice(0, args.take);
      },
      // Package 4b: every claim succeeds; the owner-guarded writes are the row's result
      updateMany: async (args: { where: { id: string }; data: { status?: string; claimToken?: string | null } }) => {
        if (typeof args.data.claimToken !== 'string') db.updates.push(args);
        return { count: 1 };
      },
    },
  },
}));
vi.mock('../src/outcomes/resolve', () => ({
  resolveOneOutcome: async (_client: unknown, row: { label: string }) => {
    switch (row.label) {
      case 'INSIDER_EXIT':
        return { status: 'RESOLVED', value: true, evidence: {} };
      case 'SELL_IMPAIRED':
        return { status: 'NA', value: null, reason: 'not applicable', evidence: {} };
      case 'LIQ_IMPAIRED':
        return { status: 'UNRESOLVABLE', value: null, reason: 'no primary pool', evidence: {} };
      case 'DRAWDOWN_80':
        return { status: 'UNRESOLVABLE', value: null, reason: 'network timeout', evidence: {} };
      default:
        throw new Error('code-path bug');
    }
  },
}));

const { sweepDueOutcomes } = await import('../src/outcomes/loop');

const row = (id: string, label: string) => ({ id, label, horizon: '24h', tokenAddress: `0x${id}`, evidence: null });

beforeEach(() => {
  db.rows = [];
  db.findMany = [];
  db.updates = [];
});

describe('sweepDueOutcomes — Package 2b counts', () => {
  it('an empty sweep reports zero picks and an empty label split', async () => {
    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });
    expect(r).toEqual({
      picked: 0,
      pickedByLabel: {},
      resolved: 0,
      na: 0,
      unresolvable: 0,
      retryLater: 0,
      failed: 0,
      claimSkipped: 0,
      lostClaim: 0,
    });
    expect(db.updates).toHaveLength(0);
  });

  it('splits picks by label and counts each row result once', async () => {
    db.rows = [
      row('i1', 'INSIDER_EXIT'),
      row('i2', 'INSIDER_EXIT'),
      row('s1', 'SELL_IMPAIRED'),
      row('l1', 'LIQ_IMPAIRED'),
      row('d1', 'DRAWDOWN_80'),
      row('t1', 'TRADING_ALIVE'),
    ];
    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair', concurrency: 3 });
    expect(r).toEqual({
      picked: 6,
      pickedByLabel: { INSIDER_EXIT: 2, SELL_IMPAIRED: 1, LIQ_IMPAIRED: 1, DRAWDOWN_80: 1, TRADING_ALIVE: 1 },
      resolved: 2,
      na: 1,
      unresolvable: 1,
      retryLater: 1,
      failed: 1,
      claimSkipped: 0,
      lostClaim: 0,
    });
    // grading and retry writes are unchanged: one update per row, statuses only on graded rows
    const byId = Object.fromEntries(db.updates.map((u) => [u.where.id, u.data.status]));
    expect(byId).toEqual({
      i1: 'RESOLVED',
      i2: 'RESOLVED',
      s1: 'NA',
      l1: 'UNRESOLVABLE',
      d1: undefined, // deferred: stays PENDING
      t1: undefined, // code-path failure: backoff stamp only
    });
    // every write releases the attempt's claim
    for (const u of db.updates) expect(u.data.claimToken).toBeNull();
  });

  it('selection is still one oldest-first query per label, capped at the batch', async () => {
    db.rows = [row('i1', 'INSIDER_EXIT'), row('i2', 'INSIDER_EXIT'), row('s1', 'SELL_IMPAIRED')];
    const r = await sweepDueOutcomes({} as never, 2, { order: 'fair' });
    expect(db.findMany).toHaveLength(5);
    for (const q of db.findMany) expect(q).toMatchObject({ orderBy: { horizonAt: 'asc' }, take: 2 });
    expect(r.picked).toBe(2);
    expect(r.pickedByLabel).toEqual({ INSIDER_EXIT: 1, SELL_IMPAIRED: 1 });
  });
});
