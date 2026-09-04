import { getChainConfig } from '@launch-auditor/chain';
import type { PublicClient } from 'viem';
import { loadEnv } from '../env';
import { POOLS_STREAM, getCursor, setCursor } from './cursor';
import { detectPools } from './detect';
import { ingestPool } from './ingest';

export interface PollResult {
  from: bigint;
  to: bigint;
  poolsSeen: number;
  launchesIndexed: number;
}

export interface PollOptions {
  chainId?: number;
  /** first run with no cursor: start at head (live) vs block 0 (full history) */
  startAtHeadIfEmpty?: boolean;
  /** cap blocks advanced in one call, for bounded replay progress */
  maxSpan?: bigint;
}

/**
 * Advance the pool-creation cursor once: read new logs up to a safe head,
 * ingest each pool as a `launches` row, persist the new cursor.
 */
export async function pollOnce(
  client: PublicClient,
  opts: PollOptions = {},
): Promise<PollResult> {
  const env = loadEnv();
  const chainId = opts.chainId ?? env.chainId;
  const cfg = getChainConfig(chainId);

  const head = await client.getBlockNumber();
  const safeHead = head > env.headLagBlocks ? head - env.headLagBlocks : 0n;

  let cursor = await getCursor(chainId, POOLS_STREAM);
  if (cursor === null) {
    cursor = (opts.startAtHeadIfEmpty ?? true) ? safeHead : 0n;
    await setCursor(chainId, POOLS_STREAM, cursor);
  }
  if (cursor >= safeHead) {
    return { from: cursor, to: cursor, poolsSeen: 0, launchesIndexed: 0 };
  }

  const from = cursor + 1n;
  const to =
    opts.maxSpan && from + opts.maxSpan - 1n < safeHead
      ? from + opts.maxSpan - 1n
      : safeHead;

  const detected = await detectPools(client, chainId, from, to, cfg.getLogsMaxRange);
  let launchesIndexed = 0;
  for (const dp of detected) {
    const id = await ingestPool(dp, {
      client,
      chainId,
      quotaPerCreator24h: env.quotaPerCreator24h,
    });
    if (id) launchesIndexed += 1;
  }

  await setCursor(chainId, POOLS_STREAM, to);
  return { from, to, poolsSeen: detected.length, launchesIndexed };
}

export interface StopSignal {
  stopped: boolean;
}

export async function runPoller(client: PublicClient, signal: StopSignal): Promise<void> {
  const { pollIntervalMs } = loadEnv();
  while (!signal.stopped) {
    try {
      const r = await pollOnce(client);
      if (r.poolsSeen > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[watcher] ${r.from}-${r.to}: ${r.poolsSeen} pools, ${r.launchesIndexed} new launches`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[watcher] poll error', err);
    }
    await new Promise((res) => setTimeout(res, pollIntervalMs));
  }
}
