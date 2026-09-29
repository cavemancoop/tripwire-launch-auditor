import { beforeEach, describe, expect, it, vi } from 'vitest';

const inner = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  http: () => () => ({ config: {}, request: (...a: unknown[]) => inner.request(...a), value: {} }),
}));

const { budgetedHttp, resetRpcWireStats, rpcWireStats, rpcMethodStats, rpcOutcomeCellStats, withRpcOutcomeCell } =
  await import('../src/transport');
const { RequestScheduler } = await import('../src/scheduler');
const { runCancellableRpc, RpcCancelledError } = await import('../src/cancel');

const indexCell = 'live:TRADING_ALIVE@24h:index';
const qualifiedCell = 'live:INSIDER_EXIT@6h:qualified';
const args = { method: 'eth_getLogs', params: [] };

function request(scheduler = new RequestScheduler({ rpm: 6000, maxInFlight: 1 }), retryCount = 0) {
  return budgetedHttp('http://rpc.test', {
    scheduler, priority: 2, chainId: 4663, retryCount, rateLimitRetries: 1,
  })({}).request as (a: typeof args) => Promise<unknown>;
}

beforeEach(() => {
  resetRpcWireStats();
  inner.request.mockReset();
});

describe('budgeted transport outcome-cell attribution', () => {
  it('keeps queued concurrent rows in their own async contexts and excludes unrelated work', async () => {
    let release!: (value: string) => void;
    inner.request.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
    inner.request.mockResolvedValue('ok');
    const req = request();
    const first = withRpcOutcomeCell(indexCell, () => req(args));
    await vi.waitFor(() => expect(inner.request).toHaveBeenCalledTimes(1));
    const second = withRpcOutcomeCell(qualifiedCell, () => req(args));
    await Promise.resolve();
    expect(inner.request).toHaveBeenCalledTimes(1); // second row is still queued
    release('first');
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'ok']);
    expect(rpcOutcomeCellStats()).toEqual({ [indexCell]: 1, [qualifiedCell]: 1 });

    await req(args); // watcher/commit-style call outside any outcome context
    expect(rpcWireStats().attempts).toBe(3);
    expect(rpcMethodStats().eth_getLogs).toBe(3);
    expect(rpcOutcomeCellStats()).toEqual({ [indexCell]: 1, [qualifiedCell]: 1 });
  });

  it('counts retries in the owning cell, but not a request cancelled before send', async () => {
    inner.request.mockRejectedValueOnce(new Error('rate limit exceeded')).mockResolvedValue('ok');
    const req = request();
    await expect(withRpcOutcomeCell(indexCell, () => req(args))).resolves.toBe('ok');
    expect(rpcOutcomeCellStats()).toEqual({ [indexCell]: 2 });
    expect(rpcMethodStats().eth_getLogs).toBe(2);

    const work = runCancellableRpc(async () => {
      await Promise.resolve();
      return withRpcOutcomeCell(qualifiedCell, () => req(args));
    });
    work.cancel(new Error('deadline'));
    await expect(work.result).rejects.toBeInstanceOf(RpcCancelledError);
    expect(rpcOutcomeCellStats()).toEqual({ [indexCell]: 2 });
    expect(rpcWireStats().attempts).toBe(2);
  });

  it('folds an invalid tag into other and never logs the tag text', async () => {
    inner.request.mockResolvedValue('ok');
    await withRpcOutcomeCell('secret-url-and-address', () => request()(args));
    expect(rpcOutcomeCellStats()).toEqual({ other: 1 });
    expect(JSON.stringify(rpcOutcomeCellStats())).not.toContain('secret-url-and-address');
  });

  it('keeps a transport-level retry in the owning cell', async () => {
    inner.request.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue('ok');
    await expect(withRpcOutcomeCell(qualifiedCell, () => request(undefined, 1)(args))).resolves.toBe('ok');
    expect(rpcWireStats().attempts).toBe(2);
    expect(rpcOutcomeCellStats()).toEqual({ [qualifiedCell]: 2 });
  });
});
