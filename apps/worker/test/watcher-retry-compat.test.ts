import { describe, expect, it, vi } from 'vitest';
import { isTransientRpcError, withRetry } from '../src/watcher/retry';
import { QUOTA_18_SEP, named, viemRpcError } from './fixtures/outcome-quota';

// Review 896555be, slice B: the watcher's in-place retry now maps the shared RPC
// taxonomy plus its own lag set. The pre-change classifier, verbatim, is the
// compatibility baseline: every row either keeps its old answer or is a listed,
// intended change.
const OLD_TRANSIENT_MESSAGE =
  /could not be found|not be processed on a block yet|not found|rate.?limit|too many requests|429|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network is busy|exceeds defined limit|try again in a moment|-32005|-32000/i;
const OLD_TRANSIENT_NAME = /NotFoundError|TimeoutError|HttpRequestError|RpcRequestError|LimitExceededError/i;
function oldIsTransientRpcError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const name = 'name' in err ? String((err as { name?: unknown }).name ?? '') : '';
    if (OLD_TRANSIENT_NAME.test(name)) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return OLD_TRANSIENT_MESSAGE.test(msg);
}

const unchanged: Array<[string, unknown, boolean]> = [
  // watcher lag: a read racing a lagging node
  ['viem not-found by name', named('TransactionNotFoundError', 'nope'), true],
  ['block not found by name', named('BlockNotFoundError', 'Block at number "123" could not be found.'), true],
  ['could not be found', new Error('Block at number "123" could not be found.'), true],
  ['receipt not processed yet', new Error('Transaction may not be processed on a block yet.'), true],
  ['-32000', new Error('-32000 header not found'), true],
  ['RpcRequestError by name', viemRpcError('execution reverted'), true],
  ['LimitExceededError by name', named('LimitExceededError', 'Request exceeds defined limit'), true],
  // rate limits
  ['429', new Error('429 Too Many Requests'), true],
  ['rate limit', new Error('rate limit exceeded'), true],
  ['ordofi busy', new Error('network is busy, try again in a moment (-32005)'), true],
  // transport
  ['socket hang up', new Error('socket hang up'), true],
  ['ETIMEDOUT', new Error('connect ETIMEDOUT 10.0.0.1:443'), true],
  ['ECONNRESET', new Error('read ECONNRESET'), true],
  ['TimeoutError by name', named('TimeoutError', 'The request took too long to respond.'), true],
  ['HttpRequestError by name', named('HttpRequestError', 'HTTP request failed.\n\nStatus: 503'), true],
  // not transient
  ['code bug', new Error('Cannot read properties of undefined'), false],
  ['plain revert', new Error('execution reverted'), false],
  ['generic upstream error', new Error('upstream RPC error'), false],
  ['bare quota text', new Error(QUOTA_18_SEP), false],
  ['undefined', undefined, false],
];

/** [name, error, old answer, new answer]: each an intended change */
const changed: Array<[string, unknown, boolean, boolean]> = [
  // quota lasts until the provider's cycle resets; seconds of backoff only spend calls
  ['quota in viem details (RpcRequestError name)', viemRpcError(QUOTA_18_SEP), true, false],
  ['quota delivered as HTTP 429', new Error(`HTTP request failed.\n\nStatus: 429\nDetails: ${QUOTA_18_SEP}`), true, false],
  // the endpoint is not the failure
  ['plain revert behind a host with 429 in it', new Error('execution reverted at https://nd-429-005-777.p2pify.com/KEY'), true, false],
  ['bug behind a host named timeout', new Error('bad shape from https://timeout.rpc.example/KEY'), true, false],
  // the shared taxonomy reads details and causes, and knows more transport texts
  ['socket failure in a cause', named('CallExecutionError', 'Execution failed.', { cause: new Error('socket hang up') }), false, true],
  ['rate limit in details only', named('CallExecutionError', 'Execution failed.', { details: 'rate limit exceeded' }), false, true],
  ['fetch failed', new Error('fetch failed'), false, true],
  ['request timed out', new Error('request timed out'), false, true],
  ['bare network', new Error('network connection lost'), false, true],
];

describe('isTransientRpcError — compatibility with the pre-896555be classifier', () => {
  it.each(unchanged)('%s: unchanged', (_n, err, expected) => {
    expect(oldIsTransientRpcError(err)).toBe(expected);
    expect(isTransientRpcError(err)).toBe(expected);
  });

  it.each(changed)('%s: intended change', (_n, err, before, after) => {
    expect(oldIsTransientRpcError(err)).toBe(before);
    expect(isTransientRpcError(err)).toBe(after);
  });
});

describe('withRetry — quota is not retried in place', () => {
  it('a quota refusal is attempted once and rethrown whole', async () => {
    const fn = vi.fn().mockRejectedValue(viemRpcError(QUOTA_18_SEP));
    await expect(withRetry(fn, { tries: 4, delayMs: 1 })).rejects.toThrow(/monthly quota/);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('a timeout nested in a cause is retried', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(named('CallExecutionError', 'Execution failed.', { cause: new Error('request timed out') }))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { tries: 3, delayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
