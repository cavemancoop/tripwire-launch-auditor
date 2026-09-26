import { describe, expect, it, vi } from 'vitest';
import { getLogsChunked } from '../src/logs';

// Package 4b (review d17cd0c4): once the signal aborts, no further chunk is requested.
describe('getLogsChunked — cancellation', () => {
  it('cancelling after chunk 2 of 5 issues exactly 2 eth_getLogs calls', async () => {
    const ac = new AbortController();
    const client = {
      request: vi.fn(async () => {
        if (client.request.mock.calls.length === 2) ac.abort(new Error('deadline'));
        return [];
      }),
    };
    await expect(
      getLogsChunked(client as never, { fromBlock: 0n, toBlock: 49n, maxRange: 10, signal: ac.signal }),
    ).rejects.toThrow('deadline');
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it('an already-aborted signal issues no call', async () => {
    const ac = new AbortController();
    ac.abort(new Error('deadline'));
    const client = { request: vi.fn(async () => []) };
    await expect(
      getLogsChunked(client as never, { fromBlock: 0n, toBlock: 49n, maxRange: 10, signal: ac.signal }),
    ).rejects.toThrow('deadline');
    expect(client.request).not.toHaveBeenCalled();
  });

  it('without a signal every chunk is requested', async () => {
    const client = { request: vi.fn(async () => []) };
    await getLogsChunked(client as never, { fromBlock: 0n, toBlock: 49n, maxRange: 10 });
    expect(client.request).toHaveBeenCalledTimes(5);
  });
});
