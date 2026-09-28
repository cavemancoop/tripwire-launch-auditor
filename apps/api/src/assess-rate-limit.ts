/** Shared admission limit for the free, RPC-consuming assessment endpoint. */
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { Queue } from 'bullmq';
import { ASSESS_QUEUE, parseRedisUrl } from './assess-queue';
import { AssessRedisTimeoutError, withAssessRedisDeadline } from './assess-redis-deadline';

export const ASSESS_PER_IP_PER_MINUTE = 12;
export const ASSESS_GLOBAL_PER_MINUTE = 30;

export interface AssessRateResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export type AssessRateLimiter = (ip: string | null) => Promise<AssessRateResult>;

const INCREMENT_IF_WITHIN_LIMIT = `
local globalCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local ipCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if globalCount >= tonumber(ARGV[1]) or ipCount >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
if globalCount == 0 then redis.call('EXPIRE', KEYS[1], 120) end
redis.call('INCR', KEYS[2])
if ipCount == 0 then redis.call('EXPIRE', KEYS[2], 120) end
return 1
`;


/** Group an IPv6 /64 to prevent cheap address rotation within one client subnet. */
export function assessClientBucket(ip: string): string {
  if (!ipaddr.isValid(ip)) return 'unknown';
  const address = ipaddr.process(ip);
  if (address instanceof ipaddr.IPv4) return `ipv4:${address.toString()}`;
  return `ipv6:${address.parts.slice(0, 4).map((part) => part.toString(16).padStart(4, '0')).join(':')}/64`;
}

/** Redis keeps the limit consistent across API replicas and deploys. */
export function makeAssessRateLimiter(
  redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379',
  now = Date.now,
): AssessRateLimiter {
  let queue: Queue | undefined;
  const clientsWithCommand = new WeakSet<object>();
  return async (ip) => {
    if (!queue) {
      queue = new Queue(ASSESS_QUEUE, { connection: parseRedisUrl(redisUrl) });
      queue.on('error', () => {}); // the awaited operation reports the failure to the route
    }
    const activeQueue = queue;
    try {
      return await withAssessRedisDeadline((async () => {
        const ms = now();
        const minute = Math.floor(ms / 60_000);
        const ipHash = createHash('sha256').update(ip ? assessClientBucket(ip) : 'global-only').digest('hex').slice(0, 32);
        const client = await activeQueue.client;
        if (!clientsWithCommand.has(client)) {
          client.defineCommand('tripwireAssessRateV1', { numberOfKeys: 2, lua: INCREMENT_IF_WITHIN_LIMIT });
          clientsWithCommand.add(client);
        }
        const result = await client.runCommand('tripwireAssessRateV1', [
          `tripwire:assess:global:${minute}`,
          `tripwire:assess:ip:${ipHash}:${minute}`,
          ASSESS_GLOBAL_PER_MINUTE,
          ip ? ASSESS_PER_IP_PER_MINUTE : ASSESS_GLOBAL_PER_MINUTE,
        ]);
        return { allowed: result === 1, retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (ms % 60_000)) / 1_000)) };
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
