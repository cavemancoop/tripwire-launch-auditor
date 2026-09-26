import { rpcErrorKinds, rpcErrorText } from '@launch-auditor/rpc-budget';

/**
 * A load-balanced RPC can serve `eth_getLogs` from a node a few seconds ahead of
 * the node that then answers `getTransaction` / `getBlock`, so a just-seen tx or
 * block reads back as "not found". Shallow reorgs look the same. These are
 * transient: back off and retry.
 */

/** Review 896555be: the watcher's own lag signals, beyond the shared taxonomy's
 *  rate-limit and transport kinds — a read racing a lagging node, and the viem
 *  error classes it arrives as. Matched against the shared classifier's text. */
const LAG_MESSAGE = /could not be found|not be processed on a block yet|not found|-32000/i;
const LAG_NAME = /NotFoundError|RpcRequestError|LimitExceededError/i;

/** Transient to an in-place retry: a rate limit, a transport failure, or node lag.
 *  A quota refusal is not — it lasts until the provider's cycle resets, so a few
 *  seconds of backoff only spend calls; the caller's own hold (the poller's
 *  cursor, the outcome sweep's paused clock) retries it later. */
export function isTransientRpcError(err: unknown): boolean {
  const kinds = rpcErrorKinds(err);
  if (kinds.includes('quota')) return false;
  if (kinds.includes('rate_limit') || kinds.includes('transport')) return true;
  const text = rpcErrorText(err);
  return LAG_MESSAGE.test(text) || LAG_NAME.test(text);
}

export interface RetryOptions {
  tries?: number;
  /** base delay; grows linearly per attempt */
  delayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const tries = opts.tries ?? 4;
  const delayMs = opts.delayMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientRpcError(err) || attempt === tries - 1) throw err;
      await new Promise((res) => setTimeout(res, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

export class DeadlineError extends Error {
  constructor(ms: number, label?: string) {
    super(`deadline of ${ms}ms exceeded${label ? ` for ${label}` : ''}`);
    this.name = 'DeadlineError';
  }
}

/**
 * Reject with {@link DeadlineError} if `fn` has not settled within `ms`. The
 * underlying promise is not cancelled (JS can't) but the shared RPC scheduler
 * rate-limits whatever it's doing, so it settles and is GC'd soon after. Use
 * this to stop one pathological launch / outcome from stalling a whole backfill
 * — the earlier 24h "hang" was one T+10m scan waiting forever on a dead socket.
 */
export function withDeadline<T>(fn: () => Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(ms, label)), ms);
    fn().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
