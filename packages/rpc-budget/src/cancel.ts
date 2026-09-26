import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Package 4b (review d17cd0c4): cancellation of budgeted RPC work. A caller that
 * gives up on a piece of work (the outcome sweep's per-row deadline) runs it
 * under an AbortSignal carried in async context, so every request the work
 * issues — through viem actions, chunked log scans and retry loops alike — sees
 * the signal without threading it through each resolver's arguments.
 *
 * Only work not yet started is cancelled: a queued scheduler job is dropped, the
 * next chunk / retry never begins. A request already in flight finishes in its
 * slot. Opt-in only: code that persists degraded fallbacks on an RPC error (the
 * T+10m feature pass) must not run under a signal.
 */
export class RpcCancelledError extends Error {
  constructor(reason?: unknown) {
    super(`RPC request cancelled${reason instanceof Error ? ` (${reason.message})` : ''}`, { cause: reason });
    this.name = 'RpcCancelledError';
  }
}

const MAX_CAUSE_DEPTH = 8;

/** Whether the error is, or wraps (viem nests transport errors in `cause`), a cancellation. */
export function isRpcCancelled(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e != null && typeof e === 'object' && depth < MAX_CAUSE_DEPTH; depth++) {
    if ((e as { name?: unknown }).name === 'RpcCancelledError') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const context = new AsyncLocalStorage<AbortSignal>();

/** The cancellation signal of the work currently running, if any. */
export function currentRpcSignal(): AbortSignal | undefined {
  return context.getStore();
}

/** Throw {@link RpcCancelledError} if the signal (default: the current one) is aborted. */
export function throwIfRpcCancelled(signal: AbortSignal | undefined = currentRpcSignal()): void {
  if (signal?.aborted) throw new RpcCancelledError(signal.reason);
}

export interface CancellableRpcWork<T> {
  result: Promise<T>;
  /** stop issuing further RPC for this work; idempotent */
  cancel: (reason?: unknown) => void;
}

/**
 * Run `fn` under a fresh cancellation signal. An enclosing signal, when there is
 * one, cancels this work too. The link to it is dropped once `fn` settles.
 */
export function runCancellableRpc<T>(fn: () => Promise<T>): CancellableRpcWork<T> {
  const controller = new AbortController();
  const parent = currentRpcSignal();
  const onParentAbort = (): void => controller.abort(parent!.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', onParentAbort, { once: true });

  // async wrapper: `fn` starts synchronously, and a synchronous throw becomes a rejection
  const result = context.run(controller.signal, async () => fn());
  const unlink = (): void => parent?.removeEventListener('abort', onParentAbort);
  result.then(unlink, unlink);
  return {
    result,
    cancel: (reason?: unknown) => {
      if (!controller.signal.aborted) controller.abort(reason);
    },
  };
}
