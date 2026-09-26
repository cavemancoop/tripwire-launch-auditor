import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review 896555be, resolver → sweep: an archive miss whose cause timed out
// (errors.test.ts:93) is a provider failure the sweep defers. Before slice B,
// resolveSurvival classified by the first kind only ('archive'), truncated the
// error to its first line and returned UNRESOLVABLE, so the sweep wrote the row
// terminal on its first attempt. The real sweep and the real TRADING_ALIVE /
// SELL_IMPAIRED resolvers run here, with Postgres and dispatch stubbed as in
// outcomes-quota-sweep.test.ts. Genuine archive misses and reverts still terminalize.
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
    outcome: {
      findMany: async (args: { where: { label?: string }; take: number }) =>
        st.rows.filter((r) => r.label === args.where.label).slice(0, args.take),
      update: async (args: Update) => {
        st.updates.push(args);
        return {};
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
const { failingClient, named } = await import('./fixtures/outcome-quota');

/** the fixture errors.test.ts:93 pins: an archive miss whose cause timed out */
const archiveAndTimeout = () => named('Error', 'header not found', { cause: new Error('request timed out') });

const row = (id: string, label: string): Row => ({ id, label, horizon: '24h', tokenAddress: `0x${id}`, evidence: null });

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

describe('sweepDueOutcomes — a provider failure nested under an archive miss (review 896555be)', () => {
  // the survival scan's own withRetry takes one 1.5s backoff on the transient error
  it('stays PENDING on the give-up clock; genuine archive misses and reverts still terminalize', { timeout: 15_000 }, async () => {
    st.rows = [
      row('alive-nested', 'TRADING_ALIVE'),
      row('alive-archive', 'TRADING_ALIVE'),
      row('sell-nested', 'SELL_IMPAIRED'),
      row('sell-revert', 'SELL_IMPAIRED'),
    ];
    st.clients = {
      'alive-nested': failingClient(archiveAndTimeout()),
      'alive-archive': failingClient(new Error('missing trie node 0xab')),
      'sell-nested': failingClient(archiveAndTimeout()),
      'sell-revert': failingClient(new Error('execution reverted: rate limit exceeded')),
    };

    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });

    expect(r).toMatchObject({ picked: 4, resolved: 0, na: 0, unresolvable: 2, retryLater: 2, failed: 0 });

    // deferred: no status, no value, first deferral starts the clock
    for (const id of ['alive-nested', 'sell-nested']) {
      const d = updateFor(id);
      expect(d.status).toBeUndefined();
      expect('value' in d).toBe(false);
      expect(d.evidence).toMatchObject({ firstDeferredAt: expect.any(String), deferrals: 1 });
    }
    expect((updateFor('alive-nested').evidence as { lastError: string }).lastError).toContain('header not found');
    expect((updateFor('sell-nested').evidence as { lastError: string }).lastError).toMatch(/^spot sell quote network/);

    // unchanged: the row's own results are terminal on the first attempt
    expect(updateFor('alive-archive')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect((updateFor('alive-archive').evidence as { reason: string }).reason).toBe(
      'could not scan the survival window: missing trie node 0xab',
    );
    expect(updateFor('sell-revert')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect((updateFor('sell-revert').evidence as { reason: string }).reason).toBe('spot sell quote revert at horizon block');
  });
});
