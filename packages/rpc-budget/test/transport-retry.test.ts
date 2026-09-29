import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcRequestError } from 'viem';

// Package 4a (review 896555be): the transport's in-slot retry decides from the
// shared taxonomy — provider text in `details` counts, a URL does not, and a
// quota refusal delivered as HTTP 429 is not retried for seconds inside the slot.
const inner = vi.hoisted(() => ({ request: null as unknown as (...a: unknown[]) => Promise<unknown> }));

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  http: () => () => ({ config: {}, request: (...a: unknown[]) => inner.request(...a), value: {} }),
}));

const { budgetedHttp, resetRpcWireStats, rpcWireStats, rpcMethodStats } = await import('../src/transport');
const { RequestScheduler } = await import('../src/scheduler');

const QUOTA_18_SEP = "You've reached your monthly quota of Request Units";

const named = (name: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { name }, extra);

function request(): (a: { method: string; params: unknown[] }) => Promise<unknown> {
  const transport = budgetedHttp('http://rpc.test', {
    scheduler: new RequestScheduler({ rpm: 6000 }),
    priority: 1,
    chainId: 4663,
    rateLimitRetries: 1,
    // the mock bypasses viem's transient-failure retry, which the transport now
    // runs itself (review ffa98d81, transport-http-retry.test.ts); off here so
    // these cases see only the rate-limit decision, as before
    retryCount: 0,
  });
  return transport({}).request as never;
}

const args = { method: 'eth_blockNumber', params: [] };

beforeEach(() => {
  resetRpcWireStats();
  inner.request = vi.fn();
});

describe('budgetedHttp — in-slot rate-limit retry (Package 4a)', () => {
  it('retries a rate limit whose text is only in viem details', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(named('RpcRequestError', 'RPC Request failed.', { details: 'rate limit exceeded' }))
      .mockResolvedValueOnce('0x10');
    inner.request = fn;
    await expect(request()(args)).resolves.toBe('0x10');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(rpcWireStats()).toEqual({ attempts: 2, providerFailures: 1, quotaFailures: 0 });
    expect(rpcMethodStats().eth_blockNumber).toBe(2);
    expect(Object.values(rpcMethodStats()).reduce((a, n) => a + n, 0)).toBe(rpcWireStats().attempts);
  });

  it('does not retry a quota refusal delivered as HTTP 429', async () => {
    const fn = vi.fn().mockRejectedValue(new Error(`HTTP request failed.\n\nStatus: 429\nDetails: ${QUOTA_18_SEP}`));
    inner.request = fn;
    await expect(request()(args)).rejects.toThrow(/monthly quota/);
    expect(fn).toHaveBeenCalledOnce();
    expect(rpcWireStats()).toEqual({ attempts: 1, providerFailures: 1, quotaFailures: 1 });
    expect(rpcMethodStats().eth_blockNumber).toBe(1);
  });

  it('a 429 in the endpoint host does not make an archive miss retryable', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('missing trie node\n\nURL: https://nd-429-005-777.p2pify.com/KEY'));
    inner.request = fn;
    await expect(request()(args)).rejects.toThrow(/missing trie node/);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('a 429 in request calldata does not retry a deterministic revert or count a provider failure', async () => {
    const body = { method: 'eth_call', params: [{ to: '0x1111111111111111111111111111111111114290', data: '0x' }, 'latest'] };
    const fn = vi.fn().mockRejectedValue(new RpcRequestError({ body, error: { code: 3, message: 'execution reverted' }, url: 'http://rpc.test' }));
    inner.request = fn;
    await expect(request()(args)).rejects.toThrow(/execution reverted/);
    expect(fn).toHaveBeenCalledOnce();
    expect(rpcWireStats()).toEqual({ attempts: 1, providerFailures: 0, quotaFailures: 0 });
  });

  it('an archive miss is an attempt but not a provider failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('missing trie node'));
    inner.request = fn;
    await expect(request()(args)).rejects.toThrow(/missing trie node/);
    expect(fn).toHaveBeenCalledOnce();
    expect(rpcWireStats()).toEqual({ attempts: 1, providerFailures: 0, quotaFailures: 0 });
  });

  it('puts an unfamiliar method in a bounded other bucket without exposing its text', async () => {
    inner.request = vi.fn().mockResolvedValue('ok');
    await expect(request()({ method: 'secret-URL-123', params: [] })).resolves.toBe('ok');
    expect(rpcMethodStats().other).toBe(1);
    expect(JSON.stringify(rpcMethodStats())).not.toContain('secret-URL-123');
  });
});
