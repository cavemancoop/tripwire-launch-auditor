import { http, type Transport } from 'viem';
import { cacheKey, ResponseCache } from './cache';
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
}

/**
 * A viem transport that wraps `http()` so every `request({ method, params })`
 * — which is what every viem action ultimately calls — first checks the response
 * cache, then passes through the shared {@link RequestScheduler} (token bucket +
 * priority queue). Transport-level retries happen inside a single scheduler slot,
 * so a retry does not spend an extra token.
 */
export function budgetedHttp(rpcUrl: string, opts: BudgetedHttpOptions): Transport {
  const inner = http(rpcUrl, {
    timeout: opts.timeout ?? 30_000,
    retryCount: opts.retryCount ?? 2,
    retryDelay: 400,
  });

  return (params) => {
    const t = inner(params);
    const innerRequest = t.request;

    const request = async (args: { method: string; params?: unknown }, reqOpts?: unknown) => {
      const key = opts.cache ? cacheKey(opts.chainId, args.method, args.params ?? []) : null;
      if (key && opts.cache!.has(key)) return opts.cache!.get(key);

      const result = await opts.scheduler.schedule(opts.priority, () =>
        (innerRequest as (a: unknown, o?: unknown) => Promise<unknown>)(args, reqOpts),
      );

      if (key) opts.cache!.set(key, result);
      return result;
    };

    return { ...t, request: request as typeof t.request };
  };
}
