/** Shared admission limit for the free, RPC-consuming assessment endpoint. */
import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { ASSESS_QUEUE } from './assess-queue';

export const ASSESS_PER_IP_PER_MINUTE = 12;
export const ASSESS_GLOBAL_PER_MINUTE = 30;

export interface AssessRateResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export type AssessRateLimiter = (ip: string) => Promise<AssessRateResult>;

const INCREMENT_IF_WITHIN_LIMIT = `
local globalCount = redis.call('INCR', KEYS[1])
if globalCount == 1 then redis.call('EXPIRE', KEYS[1], 120) end
local ipCount = redis.call('INCR', KEYS[2])
if ipCount == 1 then redis.call('EXPIRE', KEYS[2], 120) end
if globalCount > tonumber(ARGV[1]) or ipCount > tonumber(ARGV[2]) then return 0 end
return 1
`;

function redisConnection(url: string): { host: string; port: number; password?: string } {
  const u = new URL(url);
  return { host: u.hostname, port: u.port ? Number(u.port) : 6379, ...(u.password ? { password: u.password } : {}) };
}

/** Redis keeps the limit consistent across API replicas and deploys. */
export function makeAssessRateLimiter(
  redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379',
  now = Date.now,
): AssessRateLimiter {
  let queue: Queue | undefined;
  let commandDefined = false;
  return async (ip) => {
    queue ??= new Queue(ASSESS_QUEUE, { connection: redisConnection(redisUrl) });
    const ms = now();
    const minute = Math.floor(ms / 60_000);
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 32);
    const client = await queue.client;
    if (!commandDefined) {
      client.defineCommand('tripwireAssessRateV1', { numberOfKeys: 2, lua: INCREMENT_IF_WITHIN_LIMIT });
      commandDefined = true;
    }
    const result = await client.runCommand('tripwireAssessRateV1', [
      `tripwire:assess:global:${minute}`,
      `tripwire:assess:ip:${ipHash}:${minute}`,
      ASSESS_GLOBAL_PER_MINUTE,
      ASSESS_PER_IP_PER_MINUTE,
    ]);
    return { allowed: result === 1, retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (ms % 60_000)) / 1_000)) };
  };
}
