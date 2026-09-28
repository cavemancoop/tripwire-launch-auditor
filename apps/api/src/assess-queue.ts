/**
 * Producer side of the `assess` BullMQ queue (spec §9 `POST /v1/assess/{token}`).
 * The worker's `startAssessWorker` consumes these jobs. Queue name is the wire
 * contract with `apps/worker/src/queues.ts` — keep them in sync.
 */
import { Queue } from 'bullmq';

export const ASSESS_QUEUE = 'assess';

export interface AssessJob {
  tokenAddress: string;
}

export type AssessEnqueuer = (job: AssessJob) => Promise<{ id: string | undefined }>;

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const u = new URL(url);
  const cfg: { host: string; port: number; password?: string } = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
  };
  if (u.password) cfg.password = u.password;
  return cfg;
}

/** Real enqueuer backed by BullMQ. Lazily opens one connection. */
export function makeAssessEnqueuer(redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'): AssessEnqueuer {
  let queue: Queue | undefined;
  return async (job) => {
    queue ??= new Queue(ASSESS_QUEUE, { connection: parseRedisUrl(redisUrl) });
    const added = await queue.add('assess', job, {
      deduplication: { id: job.tokenAddress.toLowerCase() },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    // On a duplicate, BullMQ may return the ignored attempt's Job object.
    // Never report its ID unless a job with that ID actually exists.
    const retainedId = await queue.getDeduplicationJobId(job.tokenAddress.toLowerCase());
    if (retainedId) return { id: retainedId };
    return { id: (await queue.getJob(added.id!)) ? added.id : undefined };
  };
}
