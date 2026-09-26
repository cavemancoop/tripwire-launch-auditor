import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestScheduler, throwIfRpcCancelled, currentRpcSignal } from '@launch-auditor/rpc-budget';
import { DeadlineError, withDeadline } from '../src/watcher/retry';

// Package 4b (review d17cd0c4): once the deadline fires, the timed work issues no
// further budgeted RPC — no next chunk, no next retry, no queued request starts.
afterEach(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** a five-chunk scan whose every chunk goes through a scheduler like the budgeted transport */
function scan(scheduler: RequestScheduler, calls: { n: number }) {
  return async () => {
    for (let chunk = 0; chunk < 5; chunk++) {
      throwIfRpcCancelled();
      await scheduler.schedule(
        2,
        async () => {
          calls.n++;
          await sleep(100);
        },
        { signal: currentRpcSignal() },
      );
    }
    return 'done';
  };
}

describe('withDeadline — cancelRpc (Package 4b)', () => {
  it('after the deadline no further chunk starts', async () => {
    vi.useFakeTimers();
    const scheduler = new RequestScheduler({ rpm: 6_000_000, maxInFlight: 1 });
    const calls = { n: 0 };
    const p = withDeadline(scan(scheduler, calls), 250, 'scan', { cancelRpc: true });
    const settled = expect(p).rejects.toBeInstanceOf(DeadlineError);

    await vi.advanceTimersByTimeAsync(250); // chunks 1 and 2 done, chunk 3 in flight
    await settled;
    const atDeadline = calls.n;
    expect(atDeadline).toBe(3);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.n).toBe(atDeadline); // chunk 3 finishes in its slot; 4 and 5 never start
    expect(scheduler.stats.inFlight).toBe(0);
  });

  it('a request waiting in the queue at the deadline is dropped', async () => {
    vi.useFakeTimers();
    const scheduler = new RequestScheduler({ rpm: 6_000_000, maxInFlight: 1 });
    // another caller holds the only slot past the deadline
    const blocker = scheduler.schedule(0, () => sleep(1_000));
    const run = vi.fn(async () => 'late');
    const p = withDeadline(() => scheduler.schedule(2, run, { signal: currentRpcSignal() }), 100, 'queued', {
      cancelRpc: true,
    });
    const settled = expect(p).rejects.toBeInstanceOf(DeadlineError);

    await vi.advanceTimersByTimeAsync(100);
    await settled;
    await vi.advanceTimersByTimeAsync(1_000);
    await blocker;
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.stats.cancelled).toBe(1);
  });

  it('without cancelRpc the work runs on after the deadline (unchanged default)', async () => {
    vi.useFakeTimers();
    const scheduler = new RequestScheduler({ rpm: 6_000_000, maxInFlight: 1 });
    const calls = { n: 0 };
    const p = withDeadline(scan(scheduler, calls), 250, 'scan');
    const settled = expect(p).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(250);
    await settled;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.n).toBe(5);
  });

  it('work that settles in time resolves and is not cancelled', async () => {
    const scheduler = new RequestScheduler({ rpm: 6_000_000, maxInFlight: 1 });
    const calls = { n: 0 };
    vi.useFakeTimers();
    const p = withDeadline(scan(scheduler, calls), 10_000, 'scan', { cancelRpc: true });
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBe('done');
    expect(calls.n).toBe(5);
  });
});
