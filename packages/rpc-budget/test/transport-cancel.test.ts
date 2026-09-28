import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Package 4b (review d17cd0c4): a request issued under a cancelled async-context
// signal never reaches the provider, and cancelling stops the in-slot retries.
const inner = vi.hoisted(() => ({ request: null as unknown as (...a: unknown[]) => Promise<unknown> }));

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  http: () => () => ({ config: {}, request: (...a: unknown[]) => inner.request(...a), value: {} }),
}));

const { budgetedHttp, resetRpcWireStats, rpcWireStats } = await import('../src/transport');
const { RequestScheduler } = await import('../src/scheduler');
const { RpcCancelledError, runCancellableRpc } = await import('../src/cancel');

function request(scheduler = new RequestScheduler({ rpm: 6000 })) {
  const transport = budgetedHttp('http://rpc.test', {
    scheduler,
    priority: 1,
    chainId: 4663,
    rateLimitRetries: 3,
  });
  return transport({}).request as unknown as (a: { method: string; params: unknown[] }) => Promise<unknown>;
}

const args = { method: 'eth_blockNumber', params: [] };

beforeEach(() => {
  resetRpcWireStats();
  inner.request = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('budgetedHttp — cancellation (Package 4b)', () => {
  it('a request issued after cancellation never reaches the provider', async () => {
    const fn = vi.fn().mockResolvedValue('0x10');
    inner.request = fn;
    const req = request();
    const work = runCancellableRpc(async () => {
      await Promise.resolve();
      return req(args);
    });
    work.cancel(new Error('deadline'));
    await expect(work.result).rejects.toBeInstanceOf(RpcCancelledError);
    expect(fn).not.toHaveBeenCalled();
    expect(rpcWireStats().attempts).toBe(0);
  });

  it('cancelling during a rate-limit backoff stops further retries', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('rate limit exceeded'));
    inner.request = fn;
    const req = request();
    const work = runCancellableRpc(() => req(args));
    const settled = expect(work.result).rejects.toBeInstanceOf(RpcCancelledError);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledOnce(); // first attempt failed; now in backoff
    work.cancel(new Error('deadline'));
    await vi.advanceTimersByTimeAsync(20_000); // longer than every backoff step together

    await settled;
    expect(fn).toHaveBeenCalledOnce();
    expect(rpcWireStats()).toEqual({ attempts: 1, providerFailures: 1, quotaFailures: 0 });
  });

  it('work not run under a signal is unaffected', async () => {
    const fn = vi.fn().mockResolvedValue('0x10');
    inner.request = fn;
    await expect(request()(args)).resolves.toBe('0x10');
    expect(fn).toHaveBeenCalledOnce();
  });
});
