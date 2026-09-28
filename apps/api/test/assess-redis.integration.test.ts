import { randomInt } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { ASSESS_QUEUE, makeAssessEnqueuer, parseRedisUrl } from '../src/assess-queue';
import {
  ASSESS_GLOBAL_PER_MINUTE,
  ASSESS_PER_IP_PER_MINUTE,
  makeAssessRateLimiter,
} from '../src/assess-rate-limit';

const redisUrl = process.env.TEST_REDIS_URL;
const integration = redisUrl ? describe : describe.skip;
const u = new URL(redisUrl ?? 'redis://127.0.0.1:6379/15');
if (redisUrl && (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.pathname !== '/15')) {
  throw new Error('TEST_REDIS_URL must target localhost Redis database 15; refusing to obliterate a shared queue');
}
const connection = { ...parseRedisUrl(u.href), maxRetriesPerRequest: null };
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

  it('repairs a deduplication key whose referenced job hash was lost', async () => {
    queue ??= new Queue(ASSESS_QUEUE, { connection });
    await queue.obliterate({ force: true });
    const enqueue = makeAssessEnqueuer(redisUrl);
    const token = '0x00000000000000000000000000000000facecafe';
    const first = await enqueue({ tokenAddress: token });
    const client = await queue.client;
    await client.del(queue.toKey(first.id!));
    expect(await queue.getDeduplicationJobId(token)).toBe(first.id);
    expect(await queue.getJob(first.id!)).toBeUndefined();
    const repaired = await enqueue({ tokenAddress: token });
    expect(repaired.id).toBeTruthy();
    expect(repaired.id).not.toBe(first.id);
    expect(await queue.getJob(repaired.id!)).toBeDefined();
  }, 20_000);

  it('fails closed promptly when its Redis socket is unavailable', async () => {
    const dead = makeAssessRateLimiter('redis://127.0.0.1:6390/15');
    const started = Date.now();
    await expect(dead('203.0.113.9')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(7_000);
  }, 10_000);

  it('uses the global cap without a shared proxy-socket per-IP ceiling', async () => {
    const minute = Math.floor(Date.now() / 60_000) + randomInt(2_000_000, 3_000_000);
    const limit = makeAssessRateLimiter(redisUrl, () => minute * 60_000 + 1_000);
    for (let i = 0; i < ASSESS_GLOBAL_PER_MINUTE; i++) {
      expect((await limit(null)).allowed).toBe(true);
    }
    expect((await limit(null)).allowed).toBe(false);
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
    // The denied 13th request must not consume a global slot.
    for (let i = ASSESS_PER_IP_PER_MINUTE; i < ASSESS_GLOBAL_PER_MINUTE; i++) {
      expect((await (i % 2 ? a : b)(`198.51.100.${i}`)).allowed).toBe(true);
    }
    expect((await b('198.51.100.250')).allowed).toBe(false);
    const nextMinute = makeAssessRateLimiter(redisUrl, () => (minute + 1) * 60_000 + 1_000);
    expect((await nextMinute('203.0.113.44')).allowed).toBe(true);
  }, 20_000);
});
