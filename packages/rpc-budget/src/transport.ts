import { http, type Transport } from 'viem';
import { cacheKey, ResponseCache } from './cache';
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A viem transport that wraps `http()` so every `request({ method, params })`
 * — which is what every viem action ultimately calls — first checks the response
 * cache, then passes through the shared {@link RequestScheduler} (token bucket +
 * priority queue). A JSON-RPC rate-limit / "busy" error (which viem's own
 * transport retry does not catch, since it arrives as HTTP 200 + an error body)
 * is retried here with exponential backoff, all inside one scheduler slot so a
 * retry does not spend an extra token.
 */
export function budgetedHttp(rpcUrl: string, opts: BudgetedHttpOptions): Transport {
  const inner = http(rpcUrl, {
    timeout: opts.timeout ?? 30_000,
    retryCount: opts.retryCount ?? 2,
    retryDelay: 400,
  });
  const rlRetries = opts.rateLimitRetries ?? 4;

  return (params) => {
    const t = inner(params);
    const innerRequest = t.request as (a: unknown, o?: unknown) => Promise<unknown>;

    const request = async (args: { method: string; params?: unknown }, reqOpts?: unknown) => {
      const key = opts.cache ? cacheKey(opts.chainId, args.method, args.params ?? []) : null;
      if (key && opts.cache!.has(key)) return opts.cache!.get(key);

      const result = await opts.scheduler.schedule(opts.priority, async () => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= rlRetries; attempt++) {
          try {
            return await innerRequest(args, reqOpts);
          } catch (err) {
            lastErr = err;
            if (attempt === rlRetries || !isRateLimited(err)) throw err;
            await sleep(500 * 2 ** attempt + Math.random() * 250); // 0.5s, 1s, 2s, 4s (+jitter)
          }
        }
        throw lastErr;
      });

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
