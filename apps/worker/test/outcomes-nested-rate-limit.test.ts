import { ARCHIVE_PATTERN, REVERT_PATTERN, rpcErrorKinds } from '@launch-auditor/rpc-budget';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review 896555be, round 7 finding: an archive miss whose cause is a provider
// rate limit ('header not found' ← '429 Too Many Requests') carries both the
// rate_limit and archive kinds. classifyQuoteError returned `archive`, SELL_IMPAIRED
// kept only the first message line ('header not found'), and the sweep wrote the
// row UNRESOLVABLE on its first attempt. The real sweep and the real SELL_IMPAIRED
// resolver run here, with Postgres and dispatch stubbed as in
// outcomes-nested-provider-sweep.test.ts. Genuine archive misses and reverts whose
// reason mentions a rate limit still terminalize.
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
  const { resolveSellImpaired } = await import('../src/outcomes/resolve-sell-impaired');
  const { POOL_KEY, resolverCtx } = await import('./fixtures/outcome-quota');
  return {
    resolveOneOutcome: async (_client: unknown, row: Row) =>
      resolveSellImpaired(resolverCtx({ client: st.clients[row.id] as never, label: 'SELL_IMPAIRED', poolKey: POOL_KEY })),
  };
});

const { sweepDueOutcomes } = await import('../src/outcomes/loop');
const { classifyQuoteError, quoteExactInSingle } = await import('../src/outcomes/quote');
const { POOL_KEY, failingClient, named, viemRpcError } = await import('./fixtures/outcome-quota');

/** the reviewer's fixture: an archive miss whose cause is a provider 429 */
const archiveAnd429 = () => named('Error', 'header not found', { cause: new Error('429 Too Many Requests') });
/** the same, with the rate limit in a viem RpcRequestError's details */
const archiveAndViemRateLimit = () =>
  named('Error', 'missing trie node 0xab', { cause: viemRpcError('rate limit exceeded') });

/** pre-fix precedence, verbatim from round 7's quote.ts */
function round7ClassifyQuoteError(err: unknown): 'revert' | 'archive' | 'network' {
  const kinds = rpcErrorKinds(err);
  if (kinds.includes('quota') || kinds.includes('transport')) return 'network';
  if (kinds.includes('archive')) return 'archive';
  if (kinds.includes('revert')) return 'revert';
  return 'network';
}

beforeEach(() => {
  st.rows = [];
  st.updates = [];
  st.clients = {};
});

describe('classifyQuoteError — a rate limit beside an archive miss is a provider failure', () => {
  it('the fixture carries both kinds, and only the first message line says archive', () => {
    expect(rpcErrorKinds(archiveAnd429())).toEqual(['rate_limit', 'archive']);
    expect(ARCHIVE_PATTERN.test(archiveAnd429().message)).toBe(true);
  });

  it.each([
    ['archive miss with a nested 429', archiveAnd429()],
    ['archive miss with a nested viem rate limit', archiveAndViemRateLimit()],
  ])('%s: archive → network (intended change)', (_n, err) => {
    expect(round7ClassifyQuoteError(err)).toBe('archive');
    expect(classifyQuoteError(err)).toBe('network');
  });

  it.each([
    ['genuine archive miss', new Error('missing trie node 0xab'), 'archive'],
    ['genuine archive miss in viem details', viemRpcError('header not found'), 'archive'],
    ['revert whose reason says rate limit', new Error('execution reverted: rate limit exceeded'), 'revert'],
    ['viem revert whose reason says too many requests', viemRpcError('execution reverted: Too many requests from this wallet'), 'revert'],
    ['bare rate limit', new Error('rate limit exceeded'), 'network'],
  ] as const)('%s: unchanged', (_n, err, expected) => {
    expect(round7ClassifyQuoteError(err)).toBe(expected);
    expect(classifyQuoteError(err)).toBe(expected);
  });

  it('every revert the round 7 classifier returned is still a revert', () => {
    const reverts = [
      new Error('execution reverted: rate limit exceeded'),
      viemRpcError('execution reverted: Too many requests from this wallet'),
      new Error('execution reverted with data 0x08c379a04290'),
    ];
    for (const e of reverts) {
      expect(REVERT_PATTERN.test(e.message)).toBe(true);
      expect(round7ClassifyQuoteError(e)).toBe('revert');
      expect(classifyQuoteError(e)).toBe('revert');
    }
  });
});

describe('quoteExactInSingle — archive miss with a nested 429', () => {
  it('returns a network failure, not a terminal archive result', async () => {
    const q = await quoteExactInSingle({
      client: failingClient(archiveAnd429()) as never,
      quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
      poolKey: POOL_KEY,
      zeroForOne: false,
      amountIn: 10n ** 12n,
      blockNumber: 100n,
    });
    expect(q).toMatchObject({ ok: false, error: 'network' });
  });
});

describe('sweepDueOutcomes — SELL_IMPAIRED with an archive miss whose cause is a 429', () => {
  const row = (id: string): Row => ({ id, label: 'SELL_IMPAIRED', horizon: '24h', tokenAddress: `0x${id}`, evidence: null });

  const updateFor = (id: string): Update['data'] => {
    const u = st.updates.filter((x) => x.where.id === id);
    expect(u).toHaveLength(1);
    return u[0]!.data;
  };

  it('stays PENDING on the give-up clock; genuine archive misses and reverts still terminalize', async () => {
    st.rows = [row('sell-429'), row('sell-archive'), row('sell-revert')];
    st.clients = {
      'sell-429': failingClient(archiveAnd429()),
      'sell-archive': failingClient(new Error('missing trie node 0xab')),
      'sell-revert': failingClient(new Error('execution reverted: rate limit exceeded')),
    };

    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });

    expect(r).toMatchObject({ picked: 3, resolved: 0, na: 0, unresolvable: 2, retryLater: 1, failed: 0 });

    // deferred: no status, no value; the first deferral starts the clock
    const d = updateFor('sell-429');
    expect(d.status).toBeUndefined();
    expect('value' in d).toBe(false);
    expect(d.evidence).toMatchObject({ firstDeferredAt: expect.any(String), deferrals: 1 });
    expect((d.evidence as { lastError: string }).lastError).toMatch(/^spot sell quote network/);

    // unchanged: the row's own results are terminal on the first attempt
    expect(updateFor('sell-archive')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect((updateFor('sell-archive').evidence as { reason: string }).reason).toBe('spot sell quote archive at horizon block');
    expect(updateFor('sell-revert')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect((updateFor('sell-revert').evidence as { reason: string }).reason).toBe('spot sell quote revert at horizon block');
  });
});
