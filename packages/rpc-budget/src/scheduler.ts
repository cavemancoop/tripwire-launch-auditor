import { AsyncResource } from 'node:async_hooks';
import { RpcCancelledError } from './cancel';
import { PriorityQueue } from './priority-queue';
import { TokenBucket } from './token-bucket';

export interface SchedulerOptions {
  /** sustained requests per minute (token refill rate) */
  rpm: number;
  /** burst capacity; default max(ceil(rpm/10), 10) */
  burst?: number;
  /** max concurrent in-flight requests; default 12 */
  maxInFlight?: number;
  /** injectable timers/clock for tests */
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface ScheduleOptions {
  /** Package 4b: aborting drops the job if it has not started; a started job runs on */
  signal?: AbortSignal;
}

interface Job {
  priority: number;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  /** detaches the abort listener once the job leaves the queue */
  detach?: () => void;
}

export interface SchedulerStats {
  enqueued: number;
  started: number;
  completed: number;
  failed: number;
  /** Package 4b: jobs dropped before starting because their signal aborted */
  cancelled: number;
  inFlight: number;
  queued: number;
  /** count started, per priority tier */
  byPriority: Record<number, number>;
  /** observation only (Package 2): per-tier waiting, running, finished counts */
  queuedByPriority: Record<number, number>;
  inFlightByPriority: Record<number, number>;
  completedByPriority: Record<number, number>;
  failedByPriority: Record<number, number>;
}

const bump = (m: Record<number, number>, k: number, d: number): void => {
  m[k] = (m[k] ?? 0) + d;
};

/**
 * One instance per RPC URL, shared by every client that talks to it. Requests
 * are admitted in priority order, throttled by a token bucket, and capped at
 * `maxInFlight` concurrently.
 */
export class RequestScheduler {
  private readonly bucket: TokenBucket;
  private readonly queue = new PriorityQueue<Job>();
  private readonly maxInFlight: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private inFlight = 0;
  private timer: unknown;
  private pumping = false;

  private readonly counts = {
    enqueued: 0,
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    byPriority: {} as Record<number, number>,
    queuedByPriority: {} as Record<number, number>,
    inFlightByPriority: {} as Record<number, number>,
    completedByPriority: {} as Record<number, number>,
    failedByPriority: {} as Record<number, number>,
  };

  constructor(opts: SchedulerOptions) {
    const burst = opts.burst ?? Math.max(Math.ceil(opts.rpm / 30), 3);
    this.bucket = new TokenBucket({
      capacity: burst,
      refillPerSec: opts.rpm / 60,
      now: opts.now,
    });
    this.maxInFlight = opts.maxInFlight ?? 12;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  }

  schedule<T>(priority: number, run: () => Promise<T>, opts: ScheduleOptions = {}): Promise<T> {
    const { signal } = opts;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        // never queued, never spends a token
        this.counts.cancelled++;
        reject(new RpcCancelledError(signal.reason));
        return;
      }
      const job: Job = {
        priority,
        // The shared pump can run in another caller's async context. Bind each
        // job to the context in which it was queued, including no signal.
        run: AsyncResource.bind(run as () => Promise<unknown>),
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      if (signal) {
        const onAbort = (): void => {
          // already started (or finished): it runs on in its slot
          if (!this.queue.remove(job)) return;
          this.counts.cancelled++;
          bump(this.counts.queuedByPriority, priority, -1);
          reject(new RpcCancelledError(signal.reason));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        job.detach = () => signal.removeEventListener('abort', onAbort);
      }
      this.queue.push(priority, job);
      this.counts.enqueued++;
      bump(this.counts.queuedByPriority, priority, 1);
      this.pump();
    });
  }

  get stats(): SchedulerStats {
    return {
      enqueued: this.counts.enqueued,
      started: this.counts.started,
      completed: this.counts.completed,
      failed: this.counts.failed,
      cancelled: this.counts.cancelled,
      inFlight: this.inFlight,
      queued: this.queue.size,
      byPriority: { ...this.counts.byPriority },
      queuedByPriority: { ...this.counts.queuedByPriority },
      inFlightByPriority: { ...this.counts.inFlightByPriority },
      completedByPriority: { ...this.counts.completedByPriority },
      failedByPriority: { ...this.counts.failedByPriority },
    };
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    // let the current synchronous caller finish before we start draining
    queueMicrotask(() => {
      this.pumping = false;
      this.loop();
    });
  }

  private loop(): void {
    while (this.queue.size > 0 && this.inFlight < this.maxInFlight) {
      if (!this.bucket.tryTake()) {
        const wait = Math.max(this.bucket.msUntilAvailable(), 5);
        if (this.timer === undefined) {
          this.timer = this.setTimeoutFn(() => {
            this.timer = undefined;
            this.loop();
          }, wait);
        }
        return;
      }
      const job = this.queue.shift();
      if (!job) return;
      job.detach?.();
      this.inFlight++;
      this.counts.started++;
      this.counts.byPriority[job.priority] = (this.counts.byPriority[job.priority] ?? 0) + 1;
      bump(this.counts.queuedByPriority, job.priority, -1);
      bump(this.counts.inFlightByPriority, job.priority, 1);
      void this.execute(job);
    }
  }

  private async execute(job: Job): Promise<void> {
    try {
      const value = await job.run();
      this.counts.completed++;
      bump(this.counts.completedByPriority, job.priority, 1);
      job.resolve(value);
    } catch (err) {
      this.counts.failed++;
      bump(this.counts.failedByPriority, job.priority, 1);
      job.reject(err);
    } finally {
      this.inFlight--;
      bump(this.counts.inFlightByPriority, job.priority, -1);
      this.loop();
    }
  }
}
