import { randomInt } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { ASSESS_QUEUE, makeAssessEnqueuer } from '../src/assess-queue';
import {
  ASSESS_GLOBAL_PER_MINUTE,
  ASSESS_PER_IP_PER_MINUTE,
  makeAssessRateLimiter,
} from '../src/assess-rate-limit';

const redisUrl = process.env.TEST_REDIS_URL;
const integration = redisUrl ? describe : describe.skip;
const u = new URL(redisUrl ?? 'redis://127.0.0.1:6379');
const connection = { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null };
let queue: Queue | undefined;
let worker: Worker | undefined;

integration('real Redis assessment admission', () => {
  afterAll(async () => {
    if (worker) await worker.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('deduplicates concurrent same-token requests until the job completes, then permits a new job', async () => {
    queue = new Queue(ASSESS_QUEUE, { connection });
    await queue.obliterate({ force: true });
    const enqueueA = makeAssessEnqueuer(redisUrl);
    const enqueueB = makeAssessEnqueuer(redisUrl);
    const token = '0x00000000000000000000000000000000deadbeef';
    const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? enqueueA : enqueueB)({ tokenAddress: token })));
    expect(new Set(ids.map((r) => r.id)).size).toBe(1);
    expect(ids[0]?.id).toBeTruthy();
    expect(await queue.getWaitingCount()).toBe(1);

    worker = new Worker(ASSESS_QUEUE, async () => true, { connection, autorun: false });
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('assessment worker did not complete')), 10_000);
      worker!.once('completed', () => { clearTimeout(timeout); resolve(); });
      worker!.once('error', reject);
    });
    void worker.run();
    await completed;
    await worker.close();
    worker = undefined;
    expect(await queue.getDeduplicationJobId(token)).toBeNull();
    const next = await enqueueA({ tokenAddress: token });
    expect(next.id).toBeTruthy();
    expect(next.id).not.toBe(ids[0]?.id);
    expect(await queue.getWaitingCount()).toBe(1);
  }, 20_000);

  it('releases token deduplication after a failed job', async () => {
    queue ??= new Queue(ASSESS_QUEUE, { connection });
    await queue.obliterate({ force: true });
    const enqueue = makeAssessEnqueuer(redisUrl);
    const token = '0x00000000000000000000000000000000feedcafe';
    const first = await enqueue({ tokenAddress: token });
    const failingWorker = new Worker<any, any>(ASSESS_QUEUE, async () => { throw new Error('simulated failure'); }, { connection, autorun: false });
    worker = failingWorker;
    const failed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('assessment worker did not fail')), 10_000);
      failingWorker.once('failed', () => { clearTimeout(timeout); resolve(); });
      failingWorker.once('error', reject);
    });
    void failingWorker.run();
    await failed;
    await failingWorker.close();
    worker = undefined;
    expect(await queue.getDeduplicationJobId(token)).toBeNull();
    const next = await enqueue({ tokenAddress: token });
    expect(next.id).toBeTruthy();
    expect(next.id).not.toBe(first.id);
  }, 20_000);

  it('shares per-IP and global minute limits across separate limiter instances', async () => {
    const minute = Math.floor(Date.now() / 60_000) + randomInt(1_000_000, 2_000_000);
    const now = () => minute * 60_000 + 1_000;
    const a = makeAssessRateLimiter(redisUrl, now);
    const b = makeAssessRateLimiter(redisUrl, now);
    for (let i = 0; i < ASSESS_PER_IP_PER_MINUTE; i++) {
      expect((await (i % 2 ? a : b)('203.0.113.44')).allowed).toBe(true);
    }
    expect((await a('203.0.113.44')).allowed).toBe(false);
    for (let i = ASSESS_PER_IP_PER_MINUTE + 1; i < ASSESS_GLOBAL_PER_MINUTE; i++) {
      expect((await (i % 2 ? a : b)(`198.51.100.${i}`)).allowed).toBe(true);
    }
    expect((await b('198.51.100.250')).allowed).toBe(false);
    const nextMinute = makeAssessRateLimiter(redisUrl, () => (minute + 1) * 60_000 + 1_000);
    expect((await nextMinute('203.0.113.44')).allowed).toBe(true);
  }, 20_000);
});
