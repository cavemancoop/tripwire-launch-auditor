import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRequestError } from 'viem';
import { budgetedHttp, isTransientTransportError } from '../src/transport';
import { RequestScheduler } from '../src/scheduler';
import { isRpcCancelled, runCancellableRpc } from '../src/cancel';

// Review ffa98d81: viem's own http() retried transient failures (HTTP 5xx, 429,
// network errors) inside its request, out of reach of the cancellation signal, so
// a cancelled request could still send more attempts to the provider. The
// transport now runs that retry itself. Real viem http() here, fetch stubbed.

type Reply = () => Response | Promise<Response>;

const ok = (): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x10' }), {
    headers: { 'content-type': 'application/json' },
  });
const status = (code: number, headers: Record<string, string> = {}): Reply => () =>
  new Response('upstream busy', { status: code, headers });

let fetches = 0;
let replies: Reply[] = [];

beforeEach(() => {
  fetches = 0;
  replies = [];
  vi.stubGlobal('fetch', async () => {
    const reply = replies[fetches] ?? ok;
    fetches++;
    return reply();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function request(): (a: { method: string; params: unknown[] }) => Promise<unknown> {
  const transport = budgetedHttp('http://rpc.test', {
    scheduler: new RequestScheduler({ rpm: 6_000_000 }),
    priority: 1,
    chainId: 4663,
  });
  return transport({}).request as never;
}

const args = { method: 'eth_blockNumber', params: [] };

describe('budgetedHttp — transient HTTP retry without cancellation (unchanged)', () => {
  it('retries a 503 on viem’s schedule: 400 ms, then 800 ms', async () => {
    vi.useFakeTimers();
    replies = [status(503), status(503)];
    const p = request()(args);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    await vi.advanceTimersByTimeAsync(399);
    expect(fetches).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetches).toBe(2);
    await vi.advanceTimersByTimeAsync(799);
    expect(fetches).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('0x10');
    expect(fetches).toBe(3);
  });

  it('gives up after two retries with the provider error', async () => {
    vi.useFakeTimers();
    replies = [status(502), status(502), status(502), status(502)];
    const p = request()(args);
    const settled = expect(p).rejects.toBeInstanceOf(HttpRequestError);
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
    expect(fetches).toBe(3);
  });

  it('honours a numeric Retry-After header', async () => {
    vi.useFakeTimers();
    replies = [status(429, { 'Retry-After': '3' })];
    const p = request()(args);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetches).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('0x10');
    expect(fetches).toBe(2);
  });

  it('does not retry a non-transient HTTP status', async () => {
    replies = [status(400)];
    await expect(request()(args)).rejects.toBeInstanceOf(HttpRequestError);
    expect(fetches).toBe(1);
  });
});

describe('budgetedHttp — cancellation stops the transient HTTP retry (review ffa98d81)', () => {
  it('cancelling during the backoff after a 503 sends no second request', async () => {
    vi.useFakeTimers();
    replies = [status(503), status(503), status(503)];
    const req = request();
    const work = runCancellableRpc(() => req(args));
    let err: unknown;
    const settled = work.result.catch((e: unknown) => {
      err = e;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1); // first attempt failed; now in the 400 ms backoff
    work.cancel(new Error('deadline'));
    await vi.advanceTimersByTimeAsync(10_000); // longer than every backoff step together

    await settled;
    expect(isRpcCancelled(err)).toBe(true);
    expect(fetches).toBe(1);
  });

  it('a request already sent when cancelled is left to settle', async () => {
    let release!: (r: Response) => void;
    replies = [() => new Promise<Response>((r) => (release = r))];
    const req = request();
    const work = runCancellableRpc(() => req(args));

    await vi.waitFor(() => expect(fetches).toBe(1));
    work.cancel(new Error('deadline'));
    release(ok());

    await expect(work.result).resolves.toBe('0x10');
    expect(fetches).toBe(1);
  });
});

describe('isTransientTransportError — viem’s transient set', () => {
  const http = (s?: number) => new HttpRequestError({ url: 'http://rpc.test', status: s });

  it('transient: 403/408/413/429/5xx statuses, network failures, limit-exceeded/internal/unknown codes', () => {
    for (const s of [403, 408, 413, 429, 500, 502, 503, 504]) expect(isTransientTransportError(http(s))).toBe(true);
    expect(isTransientTransportError(http())).toBe(true);
    for (const code of [-1, -32005, -32603]) expect(isTransientTransportError(Object.assign(new Error('x'), { code }))).toBe(true);
  });

  it('not transient: other statuses and JSON-RPC codes', () => {
    for (const s of [400, 401, 404]) expect(isTransientTransportError(http(s))).toBe(false);
    for (const code of [-32000, -32601, 3]) expect(isTransientTransportError(Object.assign(new Error('x'), { code }))).toBe(false);
  });
});
