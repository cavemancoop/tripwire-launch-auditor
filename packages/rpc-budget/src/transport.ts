import { HttpRequestError, http, type Transport } from 'viem';
import { cacheKey, ResponseCache } from './cache';
import { currentRpcSignal, throwIfRpcCancelled } from './cancel';
import { rpcErrorKinds } from './errors';
import type { RequestScheduler } from './scheduler';

export interface BudgetedHttpOptions {
  scheduler: RequestScheduler;
  priority: number;
  chainId: number;
  cache?: ResponseCache;
  /** forwarded to viem's http() transport */
  timeout?: number;
  /** transport-level retries on transient network failures (inside one budget slot) */
  retryCount?: number;
  /** extra retries specifically for JSON-RPC rate-limit / "busy" errors (default 4) */
  rateLimitRetries?: number;
}

/** ordofi `-32005 "network is busy"`, blockmachine `rate limit exceeded`, generic 429s.
 *  Package 4a (review 896555be): the shared taxonomy decides, reading details and
 *  causes but not the URL. A quota refusal is not retried here even when it
 *  arrives as an HTTP 429 — a monthly quota does not come back within seconds. */
function isRateLimited(err: unknown): boolean {
  const kinds = rpcErrorKinds(err);
  return kinds.includes('rate_limit') && !kinds.includes('quota');
}

/** JSON-RPC codes viem's own transport retry treats as transient: unknown, limit exceeded, internal */
const TRANSIENT_RPC_CODES = new Set([-1, -32005, -32603]);
/** HTTP statuses viem's own transport retry treats as transient */
const TRANSIENT_HTTP_STATUSES = new Set([403, 408, 413, 429, 500, 502, 503, 504]);

/** Review ffa98d81: the retry decision viem's http() used to make internally
 *  (viem 2.x `buildRequest` shouldRetry), now made here so a cancellation can stop
 *  it. A coded JSON-RPC error retries only on the transient codes, an HTTP error
 *  only on the transient statuses, and anything else (a network failure, a
 *  timeout) always. */
export function isTransientTransportError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'number') return TRANSIENT_RPC_CODES.has(code);
  if (err instanceof HttpRequestError && err.status) return TRANSIENT_HTTP_STATUSES.has(err.status);
  return true;
}

/** viem's own transport backoff: a numeric Retry-After header, else `retryDelay · 2^n` */
function transientDelayMs(err: unknown, n: number, retryDelay: number): number {
  if (err instanceof HttpRequestError) {
    const retryAfter = (err as { headers?: Headers }).headers?.get('Retry-After');
    if (retryAfter?.match(/\d/)) return Number.parseInt(retryAfter, 10) * 1000;
  }
  return ~~(1 << n) * retryDelay;
}

/** A backoff that ends early when the signal aborts, so a cancelled request frees its slot. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const RETRY_DELAY_MS = 400;

/**
 * A viem transport that wraps `http()` so every `request({ method, params })`
 * — which is what every viem action ultimately calls — first checks the response
 * cache, then passes through the shared {@link RequestScheduler} (token bucket +
 * priority queue). A JSON-RPC rate-limit / "busy" error (which viem's own
 * transport retry does not catch, since it arrives as HTTP 200 + an error body)
 * is retried here with exponential backoff, all inside one scheduler slot so a
 * retry does not spend an extra token.
 *
 * Package 4b: a request issued under a cancelled signal (see `runCancellableRpc`)
 * is dropped before it starts, and a cancelled one stops its in-slot retries —
 * both these rate-limit retries and the transient-failure retries viem's http()
 * would otherwise run out of reach of the signal (review ffa98d81), so those run
 * here too, on viem's schedule. A request already sent is left to settle.
 */
export function budgetedHttp(rpcUrl: string, opts: BudgetedHttpOptions): Transport {
  // viem's own retry is off: it cannot see the cancellation signal
  const inner = http(rpcUrl, {
    timeout: opts.timeout ?? 30_000,
    retryCount: 0,
  });
  const retryCount = opts.retryCount ?? 2;
  const rlRetries = opts.rateLimitRetries ?? 4;

  return (params) => {
    const t = inner(params);
    const innerRequest = t.request as (a: unknown, o?: unknown) => Promise<unknown>;

    /** one attempt as viem's http() made it: transient failures retried `retryCount` times */
    const attempt = async (args: unknown, reqOpts: unknown, signal: AbortSignal | undefined): Promise<unknown> => {
      for (let n = 0; ; n++) {
        throwIfRpcCancelled(signal);
        try {
          return await innerRequest(args, reqOpts);
        } catch (err) {
          if (n >= retryCount || !isTransientTransportError(err) || signal?.aborted) throw err;
          await sleep(transientDelayMs(err, n, RETRY_DELAY_MS), signal);
        }
      }
    };

    const request = async (args: { method: string; params?: unknown }, reqOpts?: unknown) => {
      const key = opts.cache ? cacheKey(opts.chainId, args.method, args.params ?? []) : null;
      if (key && opts.cache!.has(key)) return opts.cache!.get(key);

      const signal = currentRpcSignal();
      const result = await opts.scheduler.schedule(
        opts.priority,
        async () => {
          let lastErr: unknown;
          for (let n = 0; n <= rlRetries; n++) {
            try {
              return await attempt(args, reqOpts, signal);
            } catch (err) {
              lastErr = err;
              if (n === rlRetries || !isRateLimited(err) || signal?.aborted) throw err;
              await sleep(500 * 2 ** n + Math.random() * 250, signal); // 0.5s, 1s, 2s, 4s (+jitter)
              throwIfRpcCancelled(signal);
            }
          }
          throw lastErr;
        },
        { signal },
      );

      // A null answer to a hash-addressed read ("no such tx / receipt / block
      // yet") is not immutable: the object can appear on the next block or on
      // the next node behind a load balancer. Caching it froze commit receipt
      // polls at "not found" for the whole deadline (2026-09-15).
      if (key && result != null) opts.cache!.set(key, result);
      return result;
    };

    return { ...t, request: request as typeof t.request };
  };
}
