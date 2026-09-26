import { ARCHIVE_PATTERN, REVERT_PATTERN } from '@launch-auditor/rpc-budget';
import { describe, expect, it, vi } from 'vitest';
import { classifyQuoteError, quoteExactInSingle, type QuoteError } from '../src/outcomes/quote';
import { quoteDecimals } from '../src/outcomes/resolve';
import { POOL_KEY, QUOTA_18_SEP, failingClient, named, viemRpcError } from './fixtures/outcome-quota';

// Review 896555be, slice B: the quoter maps the shared taxonomy instead of its own
// message regex. `revert` is an outcome signal (DRAWDOWN_80 prices the horizon at
// 0 on it), so the compatibility baseline below is the pre-change classifier,
// verbatim, and no row it called `revert` may become anything else.
function oldClassifyQuoteError(err: unknown): QuoteError {
  const msg = err instanceof Error ? err.message : String(err);
  if (ARCHIVE_PATTERN.test(msg)) return 'archive';
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network|fetch failed|429/i.test(msg)) {
    return 'network';
  }
  if (REVERT_PATTERN.test(msg)) return 'revert';
  return 'network';
}

/** the fixture errors.test.ts:93 pins: an archive miss whose cause timed out */
const archiveAndTimeout = () => named('Error', 'header not found', { cause: new Error('request timed out') });

const unchanged: Array<[string, unknown, QuoteError]> = [
  ['genuine revert', new Error('execution reverted'), 'revert'],
  [
    'wrapped revert',
    named('CallExecutionError', 'Execution reverted with reason: TRANSFER_FAILED.', {
      cause: named('ExecutionRevertedError', 'Execution reverted with reason: TRANSFER_FAILED.'),
    }),
    'revert',
  ],
  ['revert whose reason says rate limit', new Error('execution reverted: rate limit exceeded'), 'revert'],
  ['viem revert whose reason says too many requests', viemRpcError('execution reverted: Too many requests from this wallet'), 'revert'],
  ['archive miss', new Error('missing trie node 0xab'), 'archive'],
  ['archive miss in viem details', viemRpcError('header not found'), 'archive'],
  ['archive miss behind a host named network', viemRpcError('missing trie node', 'https://robinhood-network.rpc.example/KEY'), 'archive'],
  ['socket hang up', new Error('socket hang up'), 'network'],
  ['viem timeout', named('TimeoutError', 'request timeout'), 'network'],
  ['viem http failure', named('HttpRequestError', 'HTTP request failed.\n\nStatus: 503'), 'network'],
  ['bare rate limit', new Error('rate limit exceeded'), 'network'],
  ['generic upstream error', new Error('upstream RPC error'), 'network'],
  ['undefined', undefined, 'network'],
];

/** [name, error, old, new]: each an intended change */
const changed: Array<[string, unknown, QuoteError, QuoteError]> = [
  // the timed-out cause is the provider's failure: defer, don't terminalize as archive
  ['archive miss with a timed-out cause', archiveAndTimeout(), 'archive', 'network'],
  // the endpoint is not the failure
  ['revert behind a host with 429 in it', viemRpcError('execution reverted', 'https://nd-429-005-777.p2pify.com/KEY'), 'network', 'revert'],
  ['revert behind a host named network', viemRpcError('execution reverted', 'https://robinhood-network.rpc.example/KEY'), 'network', 'revert'],
  // `429` in revert data is hex, not an HTTP status
  ['revert data containing 429', new Error('execution reverted with data 0x08c379a04290'), 'network', 'revert'],
];

describe('classifyQuoteError — compatibility with the pre-896555be classifier', () => {
  it.each(unchanged)('%s: unchanged', (_n, err, expected) => {
    expect(oldClassifyQuoteError(err)).toBe(expected);
    expect(classifyQuoteError(err)).toBe(expected);
  });

  it.each(changed)('%s: intended change', (_n, err, before, after) => {
    expect(oldClassifyQuoteError(err)).toBe(before);
    expect(classifyQuoteError(err)).toBe(after);
  });

  it('no error the old classifier called a revert becomes anything else', () => {
    const all = [...unchanged.map(([, e]) => e), ...changed.map(([, e]) => e)];
    const oldReverts = all.filter((e) => oldClassifyQuoteError(e) === 'revert');
    expect(oldReverts.length).toBeGreaterThanOrEqual(4);
    for (const e of oldReverts) expect(classifyQuoteError(e)).toBe('revert');
  });
});

describe('quoteExactInSingle — mapped outcomes', () => {
  const quote = (err: unknown) =>
    quoteExactInSingle({
      client: failingClient(err) as never,
      quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
      poolKey: POOL_KEY,
      zeroForOne: false,
      amountIn: 10n ** 12n,
      blockNumber: 100n,
    });

  it('quota delivered as HTTP 429 is thrown, not a quote failure', async () => {
    await expect(quote(new Error(`HTTP request failed.\n\nStatus: 429\nDetails: ${QUOTA_18_SEP}`))).rejects.toThrow(
      /monthly quota/,
    );
  });

  it('an archive miss with a timed-out cause is a network failure', async () => {
    expect(await quote(archiveAndTimeout())).toMatchObject({ ok: false, error: 'network' });
  });

  it('a revert whose reason mentions a rate limit is still a revert', async () => {
    expect(await quote(new Error('execution reverted: rate limit exceeded'))).toMatchObject({ ok: false, error: 'revert' });
  });
});

describe('quoteDecimals — a nested provider failure does not cache the fallback', () => {
  it('an archive miss with a timed-out cause propagates; the next read returns the real decimals', async () => {
    const asset = '0x00000000000000000000000000000000000000b1';
    const down = { readContract: vi.fn(async () => { throw archiveAndTimeout(); }) };
    await expect(quoteDecimals(down as never, asset)).rejects.toThrow('header not found');
    const up = { readContract: vi.fn(async () => 6) };
    expect(await quoteDecimals(up as never, asset)).toBe(6);
    expect(up.readContract).toHaveBeenCalledOnce();
  });

  it('a plain archive miss still falls back to 18 and caches it (unchanged)', async () => {
    const asset = '0x00000000000000000000000000000000000000b2';
    const down = { readContract: vi.fn(async () => { throw new Error('missing trie node 0xab'); }) };
    expect(await quoteDecimals(down as never, asset)).toBe(18);
    const later = { readContract: vi.fn(async () => 6) };
    expect(await quoteDecimals(later as never, asset)).toBe(18);
    expect(later.readContract).not.toHaveBeenCalled();
  });
});
