/**
 * Producer side of the `assess` BullMQ queue (spec §9 `POST /v1/assess/{token}`).
 * The worker's `startAssessWorker` consumes these jobs. Queue name is the wire
 * contract with `apps/worker/src/queues.ts` — keep them in sync.
 */
import { Queue } from 'bullmq';
import { AssessRedisTimeoutError, withAssessRedisDeadline } from './assess-redis-deadline';

export const ASSESS_QUEUE = 'assess';

export interface AssessJob {
  tokenAddress: string;
}

export type AssessEnqueuer = (job: AssessJob) => Promise<{ id: string | undefined }>;

export function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
  maxRetriesPerRequest: number;
  connectTimeout: number;
  commandTimeout: number;
  enableOfflineQueue: boolean;
} {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') throw new Error('Redis URL must use redis: or rediss:');
  if (u.pathname && u.pathname !== '/' && !/^\/\d+$/.test(u.pathname)) throw new Error('Redis URL has an invalid database index');
  const cfg: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    tls?: Record<string, never>;
    maxRetriesPerRequest: number;
    connectTimeout: number;
    commandTimeout: number;
    enableOfflineQueue: boolean;
  } = {
    host: u.hostname, port: u.port ? Number(u.port) : 6379,
    maxRetriesPerRequest: 1, connectTimeout: 3_000, commandTimeout: 5_000, enableOfflineQueue: false,
  };
  if (u.username) cfg.username = decodeURIComponent(u.username);
  if (u.password) cfg.password = decodeURIComponent(u.password);
  if (u.pathname && u.pathname !== '/') cfg.db = Number(u.pathname.slice(1));
  if (u.protocol === 'rediss:') cfg.tls = {};
  return cfg;
}

// BullMQ normally removes this key on completion, failure and job removal.
// Repair only a key whose referenced job hash is absent, atomically, so a
// partial Redis restore or eviction cannot block a token forever.
const REPAIR_ORPHANED_DEDUP = `
local id = redis.call('GET', KEYS[1])
if not id then return 0 end
if redis.call('EXISTS', ARGV[1] .. id) == 1 then return 0 end
return redis.call('DEL', KEYS[1])
`;

/** Real enqueuer backed by BullMQ. Lazily opens one connection. */
export function makeAssessEnqueuer(redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'): AssessEnqueuer {
  let queue: Queue | undefined;
  const clientsWithRepair = new WeakSet<object>();
  return async (job) => {
    if (!queue) {
      queue = new Queue(ASSESS_QUEUE, { connection: parseRedisUrl(redisUrl) });
      queue.on('error', () => {}); // the awaited operation reports the failure to the route
    }
    const activeQueue = queue;
    try {
      return await withAssessRedisDeadline((async () => {
        const token = job.tokenAddress.toLowerCase();
        const options = {
          deduplication: { id: token },
          removeOnComplete: 100,
          removeOnFail: 100,
        };
        // BullMQ returns the retained job ID when a duplicate is ignored.
        const added = await activeQueue.add('assess', job, options);
        if (added.id && await activeQueue.getJob(added.id)) return { id: added.id };

        const client = await activeQueue.client;
        if (!clientsWithRepair.has(client)) {
          client.defineCommand('tripwireRepairAssessDedupV1', { numberOfKeys: 1, lua: REPAIR_ORPHANED_DEDUP });
          clientsWithRepair.add(client);
        }
        const repaired = await client.runCommand('tripwireRepairAssessDedupV1', [
          activeQueue.toKey(`de:${token}`), activeQueue.toKey(''),
        ]);
        if (repaired === 1) {
          const retry = await activeQueue.add('assess', job, options);
          if (retry.id && await activeQueue.getJob(retry.id)) return { id: retry.id };
        }
        // A very fast completed/removed job can leave no retrievable ID. Never
        // claim an ignored or orphaned ID as an active job.
        return { id: undefined };
      })());
    } catch (err) {
      if (err instanceof AssessRedisTimeoutError) {
        if (queue === activeQueue) {
          queue = undefined;
        }
        void activeQueue.disconnect().catch(() => {});
      }
      throw err;
    }
  };
}
