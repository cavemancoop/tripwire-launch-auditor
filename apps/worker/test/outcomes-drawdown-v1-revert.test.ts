import { ARCHIVE_PATTERN, REVERT_PATTERN } from '@launch-auditor/rpc-budget';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review 866d601f: review 896555be's classifier consolidation reads a revert in
// errors the pre-change quoter classifier called `network` (a `429` or `network`
// in the RPC URL, `429` in revert data). DRAWDOWN_80 prices a quoter revert at 0,
// so an existing OUTCOME_RULES_v1 row with a positive reference and no horizon
// swaps would turn from a deferred measurement into a scored positive. The real
// sweep and the real DRAWDOWN_80 resolver run here, with Postgres and dispatch
// stubbed as in outcomes-nested-rate-limit.test.ts: those rows stay PENDING as
// under v1, the provider-failure fixes still defer, and a genuine revert still scores.
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
  const { resolveDrawdown } = await import('../src/outcomes/resolve-drawdown');
  const { POOL_KEY, resolverCtx } = await import('./fixtures/outcome-quota');
  return {
    resolveOneOutcome: async (_client: unknown, row: Row) =>
      resolveDrawdown(
        resolverCtx({
          client: st.clients[row.id] as never,
          label: 'DRAWDOWN_80',
          poolKey: POOL_KEY,
          drawdownRefStart: 10n,
          drawdownRefEnd: 100n,
          horizonBlock: 200n,
        }),
      ),
  };
});

const { sweepDueOutcomes } = await import('../src/outcomes/loop');
const { classifyQuoteError } = await import('../src/outcomes/quote');
const { v1ScoresQuoteRevert } = await import('../src/outcomes/resolve-drawdown');
const { POOL_ID, QUOTA_18_SEP, named, viemRpcError } = await import('./fixtures/outcome-quota');
const { sqrtForPrice, v4SwapLog } = await import('./fixtures/logs');

/** the pre-896555be quoter classifier, verbatim (as in outcomes-quote-classify.test.ts) */
function oldClassifyQuoteError(err: unknown): 'revert' | 'archive' | 'network' {
  const msg = err instanceof Error ? err.message : String(err);
  if (ARCHIVE_PATTERN.test(msg)) return 'archive';
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network|fetch failed|429/i.test(msg)) {
    return 'network';
  }
  if (REVERT_PATTERN.test(msg)) return 'revert';
  return 'network';
}

/** the classify test's network → revert changes: v1 deferred these rows */
const reclassified: Array<[string, () => unknown]> = [
  ['revert behind a host with 429 in it', () => viemRpcError('execution reverted', 'https://nd-429-005-777.p2pify.com/KEY')],
  ['revert behind a host named network', () => viemRpcError('execution reverted', 'https://robinhood-network.rpc.example/KEY')],
  ['revert data containing 429', () => new Error('execution reverted with data 0x08c379a04290')],
];

const archiveAndTimeout = () => named('Error', 'header not found', { cause: new Error('request timed out') });
const archiveAnd429 = () => named('Error', 'header not found', { cause: new Error('429 Too Many Requests') });

/** one swap in the reference window [10, 100], none after it: the horizon falls to the quoter */
const refOnlyClient = (quoteErr: unknown) => {
  const logs = [v4SwapLog(POOL_ID, sqrtForPrice(100), 50n)];
  return {
    request: vi.fn(async ({ method, params }: { method: string; params: any[] }) => {
      if (method === 'eth_getLogs') {
        const from = BigInt(params[0].fromBlock);
        const to = BigInt(params[0].toBlock);
        return logs.filter((l) => {
          const b = BigInt(l.blockNumber);
          return b >= from && b <= to;
        });
      }
      if (method === 'eth_call') throw quoteErr;
      throw new Error(method);
    }),
  };
};

const row = (id: string): Row => ({ id, label: 'DRAWDOWN_80', horizon: '24h', tokenAddress: `0x${id}`, evidence: null });

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

describe('v1ScoresQuoteRevert — the scored-revert set is the v1 classifier’s', () => {
  it.each(reclassified)('%s: now classified revert, not scored under v1', (_n, err) => {
    const e = err() as Error;
    expect(oldClassifyQuoteError(e)).toBe('network');
    expect(classifyQuoteError(e)).toBe('revert');
    expect(v1ScoresQuoteRevert(e.message)).toBe(false);
  });

  it.each([
    ['genuine revert', new Error('execution reverted')],
    ['revert whose reason says rate limit', new Error('execution reverted: rate limit exceeded')],
    [
      'wrapped revert',
      named('CallExecutionError', 'Execution reverted with reason: TRANSFER_FAILED.', {
        cause: named('ExecutionRevertedError', 'Execution reverted with reason: TRANSFER_FAILED.'),
      }),
    ],
  ])('%s: v1 revert, still scored', (_n, e) => {
    expect(oldClassifyQuoteError(e)).toBe('revert');
    expect(classifyQuoteError(e)).toBe('revert');
    expect(v1ScoresQuoteRevert(e.message)).toBe(true);
  });
});

describe('sweepDueOutcomes — DRAWDOWN_80 with a positive reference and no horizon swaps', () => {
  it('reclassified reverts stay PENDING as under v1; a genuine revert still resolves true', async () => {
    st.rows = [...reclassified.map((_, i) => row(`dd-v1net-${i}`)), row('dd-revert')];
    reclassified.forEach(([, err], i) => (st.clients[`dd-v1net-${i}`] = refOnlyClient(err())));
    st.clients['dd-revert'] = refOnlyClient(new Error('execution reverted'));

    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });

    expect(r).toMatchObject({ picked: 4, resolved: 1, na: 0, unresolvable: 0, retryLater: 3, failed: 0 });

    reclassified.forEach((_, i) => {
      const d = updateFor(`dd-v1net-${i}`);
      expect(d.status).toBeUndefined();
      expect('value' in d).toBe(false);
      expect(d.evidence).toMatchObject({ firstDeferredAt: expect.any(String), deferrals: 1 });
      expect((d.evidence as { lastError: string }).lastError).toMatch(/^quoter network at horizon block/);
    });

    const scored = updateFor('dd-revert');
    expect(scored).toMatchObject({ status: 'RESOLVED', value: true });
    expect(scored.evidence).toMatchObject({ horizonPrice: 0, horizonSource: 'quote', ratio: 0 });
  });

  it('provider-failure fixes are kept: nested timeouts and 429s defer, quota pauses, plain archive terminalizes', async () => {
    st.rows = [row('dd-arch-timeout'), row('dd-arch-429'), row('dd-quota'), row('dd-archive')];
    st.clients = {
      'dd-arch-timeout': refOnlyClient(archiveAndTimeout()),
      'dd-arch-429': refOnlyClient(archiveAnd429()),
      'dd-quota': refOnlyClient(viemRpcError(`HTTP 429 Too Many Requests: ${QUOTA_18_SEP}`)),
      'dd-archive': refOnlyClient(new Error('missing trie node 0xab')),
    };

    const r = await sweepDueOutcomes({} as never, 25, { order: 'fair' });

    expect(r).toMatchObject({ picked: 4, resolved: 0, na: 0, unresolvable: 1, retryLater: 3, failed: 0 });
    for (const id of ['dd-arch-timeout', 'dd-arch-429']) {
      const d = updateFor(id);
      expect(d.status).toBeUndefined();
      expect(d.evidence).toMatchObject({ deferrals: 1 });
      expect((d.evidence as { lastError: string }).lastError).toMatch(/^quoter network at horizon block/);
    }
    const q = updateFor('dd-quota');
    expect(q.status).toBeUndefined();
    expect(q.evidence).not.toHaveProperty('firstDeferredAt');
    expect(q.evidence).not.toHaveProperty('deferrals');

    expect(updateFor('dd-archive')).toMatchObject({ status: 'UNRESOLVABLE', value: null });
    expect((updateFor('dd-archive').evidence as { reason: string }).reason).toBe('quoter archive at horizon block');
  });
});
