import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review 20d601b2: cancelling one outcome's RPC must not touch any other caller
// sharing the scheduler. The scheduler drains its queue from whichever async
// context happens to run it — the enqueue microtask, a token-refill timer, another
// job's completion — so each job must run under its own caller's cancellation
// context, including the explicit absence of one. Real timers throughout: fake
// timers fire callbacks from the test's context and would hide a refill timer
// armed from inside the outcome's context.
const inner = vi.hoisted(() => ({
  handlers: {} as Record<string, (n: number) => Promise<unknown>>,
  calls: [] as string[],
}));

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  http: () => () => ({
    config: {},
    request: (args: { method: string }) => {
      inner.calls.push(args.method);
      return inner.handlers[args.method]!(count(args.method));
    },
    value: {},
  }),
}));

const { budgetedHttp } = await import('../src/transport');
const { RequestScheduler } = await import('../src/scheduler');
const { PRIORITY } = await import('../src/priorities');
const { RpcCancelledError, currentRpcSignal, runCancellableRpc, throwIfRpcCancelled } = await import(
  '../src/cancel'
);

type Scheduler = InstanceType<typeof RequestScheduler>;

function count(method: string): number {
  return inner.calls.filter((m) => m === method).length;
}

/** one budgeted client per caller, all on the one scheduler, as in the worker */
function callers(scheduler: Scheduler) {
  const at = (priority: number) => {
    const transport = budgetedHttp('http://rpc.test', { scheduler, priority, chainId: 4663 });
    const request = transport({}).request as unknown as (a: { method: string; params: unknown[] }) => Promise<unknown>;
    return (method: string) => request({ method, params: [] });
  };
  return {
    outcome: at(PRIORITY.outcomes),
    watcher: at(PRIORITY.watcher),
    features: at(PRIORITY.watcher), // T+10m features run at watcher priority
    commit: at(PRIORITY.commit),
  };
}

const ok = (v: string) => () => Promise.resolve(v);
const later = (ms: number, v: string) => () => new Promise((r) => setTimeout(() => r(v), ms));
const rateLimited = () => Promise.reject(new Error('rate limit exceeded'));
/** let pending microtasks (the scheduler's pump) run */
const tick = () => new Promise((r) => setImmediate(r));

/** the unrelated core-path requests, issued outside any cancellable work */
function core(c: ReturnType<typeof callers>) {
  return Promise.all([c.watcher('eth_watcher'), c.features('eth_features'), c.commit('eth_commit')]);
}

beforeEach(() => {
  inner.calls = [];
  inner.handlers = {
    eth_outcome: ok('0x1'),
    eth_watcher: ok('0x2'),
    eth_features: ok('0x3'),
    eth_commit: ok('0x4'),
  };
});

describe('cancellation stays with its owner (review 20d601b2)', () => {
  it('admission through the enqueue microtask', async () => {
    const c = callers(new RequestScheduler({ rpm: 6000 }));
    // the outcome enqueues first, so the pump microtask is queued from its context
    const work = runCancellableRpc(() => c.outcome('eth_outcome'));
    const others = core(c);
    work.cancel(new Error('deadline'));

    await expect(work.result).rejects.toBeInstanceOf(RpcCancelledError);
    await expect(others).resolves.toEqual(['0x2', '0x3', '0x4']);
    expect(count('eth_outcome')).toBe(0);
  });

  it('admission from a token-refill timer armed by the outcome', async () => {
    const scheduler = new RequestScheduler({ rpm: 600, burst: 1 }); // one token per 100 ms
    const c = callers(scheduler);
    const work = runCancellableRpc(() => Promise.all([c.outcome('eth_outcome'), c.outcome('eth_outcome')]));
    const settled = expect(work.result).rejects.toBeInstanceOf(RpcCancelledError);
    await tick(); // the first took the only token; the refill timer is armed from the outcome's context
    expect(inner.calls).toEqual(['eth_outcome']);

    const others = core(c);
    await tick();
    work.cancel(new Error('deadline'));
    await settled;

    await expect(others).resolves.toEqual(['0x2', '0x3', '0x4']);
    expect(count('eth_outcome')).toBe(1); // the queued second request was dropped
    expect(scheduler.stats.cancelled).toBe(1);
  });

  it('admission on the in-flight outcome chunk completing; no later chunk starts', async () => {
    const c = callers(new RequestScheduler({ rpm: 6000, maxInFlight: 1 }));
    inner.handlers.eth_outcome = later(30, '0x1');
    const work = runCancellableRpc(async () => {
      for (let chunk = 0; chunk < 3; chunk++) await c.outcome('eth_outcome');
    });
    const settled = expect(work.result).rejects.toBeInstanceOf(RpcCancelledError);
    await tick(); // chunk 1 holds the only slot

    const others = core(c); // queued behind it
    work.cancel(new Error('deadline'));
    await settled; // chunk 1 finishes in its slot; chunk 2 is refused before queueing

    await expect(others).resolves.toEqual(['0x2', '0x3', '0x4']);
    expect(count('eth_outcome')).toBe(1);
  });

  it('retry backoff: the outcome stops retrying, a commit drained after it retries normally', async () => {
    const c = callers(new RequestScheduler({ rpm: 6000, maxInFlight: 1 }));
    inner.handlers.eth_outcome = rateLimited;
    inner.handlers.eth_commit = (n) => (n === 1 ? rateLimited() : Promise.resolve('0x4'));
    const work = runCancellableRpc(() => c.outcome('eth_outcome'));
    const settled = expect(work.result).rejects.toBeInstanceOf(RpcCancelledError);
    await tick(); // the first attempt failed; the outcome is backing off in the only slot

    const commit = c.commit('eth_commit');
    work.cancel(new Error('deadline'));
    await settled;

    await expect(commit).resolves.toBe('0x4'); // its own backoff ran to completion
    expect(count('eth_outcome')).toBe(1);
    expect(count('eth_commit')).toBe(2);
  });

  it('outer rate-limit backoff in an unsignalled commit survives an outcome abort', async () => {
    const scheduler = new RequestScheduler({ rpm: 6000, maxInFlight: 2 });
    const c = callers(scheduler);
    inner.handlers.eth_outcome = later(30, '0x1');
    let sawFirst!: () => void;
    const firstAttempt = new Promise<void>((resolve) => { sawFirst = resolve; });
    inner.handlers.eth_commit = (n) => {
      if (n === 1) {
        sawFirst();
        return rateLimited();
      }
      return Promise.resolve('0x4');
    };
    const transport = budgetedHttp('http://rpc.test', {
      scheduler, priority: PRIORITY.commit, chainId: 4663,
      retryCount: 0, rateLimitRetries: 1,
    });
    const commitRequest = transport({}).request as unknown as (a: { method: string; params: unknown[] }) => Promise<unknown>;

    // The outcome enqueues first, so the scheduler pump can inherit its context.
    const work = runCancellableRpc(() => c.outcome('eth_outcome'));
    const commit = commitRequest({ method: 'eth_commit', params: [] });
    const settled = expect(commit).resolves.toBe('0x4');
    await firstAttempt; // commit has entered the outer rate-limit retry path
    work.cancel(new Error('deadline'));

    await settled;
    await work.result; // already in flight: it may settle after cancellation
    expect(count('eth_commit')).toBe(2);
  });

  it('a scheduled job sees its own caller’s signal, whoever drains the queue', async () => {
    const scheduler = new RequestScheduler({ rpm: 6000, maxInFlight: 1 });
    const seen: Array<AbortSignal | undefined> = [];
    const probe = () => scheduler.schedule(0, async () => void seen.push(currentRpcSignal()));
    let own: AbortSignal | undefined;
    const work = runCancellableRpc(async () => {
      own = currentRpcSignal();
      await probe();
    });
    const plain = probe(); // drained when the cancellable job completes

    await work.result;
    await plain;
    expect(own).toBeDefined();
    expect(seen[0]).toBe(own);
    expect(seen[1]).toBeUndefined();
  });

  it('an explicit absence of a signal is not replaced by the ambient one', async () => {
    const work = runCancellableRpc(async () => {
      await tick();
      throwIfRpcCancelled(undefined);
      return 'ran';
    });
    work.cancel(new Error('deadline'));
    await expect(work.result).resolves.toBe('ran');
  });
});
