/**
 * Producer side of the `deepdive` BullMQ queue (spec §9 `POST /v1/deepdive/{token}`).
 * The worker's `startDeepdiveWorker` consumes these jobs. Queue name is the wire
 * contract with `apps/worker/src/queues.ts` — keep them in sync.
 */
import { Queue } from 'bullmq';
import { parseRedisUrl } from './assess-queue';

export const DEEPDIVE_QUEUE = 'deepdive';

export interface DeepdiveJob {
  tokenAddress: string;
  trigger: 'on_demand';
}

export type DeepdiveEnqueuer = (job: DeepdiveJob) => Promise<{ id: string | undefined }>;

/** Real enqueuer backed by BullMQ. Lazily opens one connection. */
export function makeDeepdiveEnqueuer(redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'): DeepdiveEnqueuer {
  let queue: Queue | undefined;
  return async (job) => {
    queue ??= new Queue(DEEPDIVE_QUEUE, { connection: parseRedisUrl(redisUrl) });
    const added = await queue.add('deepdive', job, {
      jobId: `${job.tokenAddress.toLowerCase()}:${job.trigger}`,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    return { id: added.id };
  };
}
