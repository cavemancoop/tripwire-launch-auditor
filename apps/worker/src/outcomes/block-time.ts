import type { PublicClient } from 'viem';

/**
 * Map a wall-clock time to the last block mined at or before it. Bounded binary
 * search over block timestamps; results memoised per (chainId, rounded second)
 * because every outcome batch for one report shares an anchor time and its
 * horizons repeat across launches.
 */
export type BlockTimeClient = Pick<PublicClient, 'getBlock' | 'getBlockNumber'>;

const cache = new Map<string, bigint>();

export const BLOCK_TIME_READ_BUCKETS = ['0', '1-4', '5-10', '11-20', '21+'] as const;
type ReadBucket = (typeof BLOCK_TIME_READ_BUCKETS)[number];
const stats = {
  lookups: 0,
  cacheHits: 0,
  blockReads: 0,
  unfinished: 0,
  failures: 0,
  readBuckets: Object.fromEntries(BLOCK_TIME_READ_BUCKETS.map((key) => [key, 0])) as Record<ReadBucket, number>,
};

/** Process-local observation only; reads include failed getBlock attempts. */
export function blockTimeStats(): typeof stats {
  return { ...stats, readBuckets: { ...stats.readBuckets } };
}

function recordReads(count: number): void {
  stats.blockReads += count;
  const bucket: ReadBucket = count === 0 ? '0' : count <= 4 ? '1-4' : count <= 10 ? '5-10' : count <= 20 ? '11-20' : '21+';
  stats.readBuckets[bucket]++;
}

export interface BlockAtTimeOptions {
  chainId?: number;
  /** cap on search iterations (each = 1 getBlock call) */
  maxIters?: number;
  /** treat the chain as starting no earlier than this block */
  minBlock?: bigint;
}

export async function blockAtTime(
  client: BlockTimeClient,
  when: Date,
  opts: BlockAtTimeOptions = {},
): Promise<bigint> {
  const targetSec = BigInt(Math.floor(when.getTime() / 1000));
  stats.lookups++;
  const key = `${opts.chainId ?? 4663}:${targetSec}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    stats.cacheHits++;
    return cached;
  }

  const maxIters = opts.maxIters ?? 18;
  let lo = opts.minBlock ?? 1n;
  let reads = 0;
  const getBlock = async (blockNumber: bigint) => {
    reads++;
    return client.getBlock({ blockNumber });
  };
  try {
    let hi = await client.getBlockNumber();

    const headTs = (await getBlock(hi)).timestamp;
    if (targetSec >= headTs) {
      cache.set(key, hi);
      return hi;
    }
    const loTs = (await getBlock(lo)).timestamp;
    if (targetSec <= loTs) {
      cache.set(key, lo);
      return lo;
    }

    let answer = lo;
    for (let i = 0; i < maxIters && lo <= hi; i++) {
      const mid = lo + (hi - lo) / 2n;
      const ts = (await getBlock(mid)).timestamp;
      if (ts <= targetSec) {
        answer = mid;
        lo = mid + 1n;
      } else {
        hi = mid - 1n;
      }
    }
    if (lo <= hi) stats.unfinished++;
    cache.set(key, answer);
    return answer;
  } catch (error) {
    stats.failures++;
    throw error;
  } finally {
    recordReads(reads);
  }
}

/** test hook */
export function clearBlockTimeCache(): void {
  cache.clear();
}

/** test hook */
export function resetBlockTimeStats(): void {
  stats.lookups = 0;
  stats.cacheHits = 0;
  stats.blockReads = 0;
  stats.unfinished = 0;
  stats.failures = 0;
  for (const key of BLOCK_TIME_READ_BUCKETS) stats.readBuckets[key] = 0;
}
