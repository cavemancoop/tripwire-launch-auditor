import { getChainConfig } from '@launch-auditor/chain';
import { prisma } from '@launch-auditor/db';
import { Worker } from 'bullmq';
import type { Hex, PublicClient } from 'viem';
import { loadEnv } from '../env';
import { QUEUE_NAMES, parseRedisUrl } from '../queues';
import { computeT10Features } from './features';

/** Run the T+10m feature pass (spec §3.3 item 6) for one launch. */
export async function runT10ForLaunch(
  client: PublicClient,
  launchId: string,
): Promise<void> {
  const launch = await prisma.launch.findUnique({ where: { id: launchId } });
  if (!launch) return;

  const cfg = getChainConfig(launch.chainId);
  const src =
    launch.poolKind === 'v4'
      ? cfg.uniswap.v4PoolManager.address
      : launch.poolAddress;
  if (!src) return;

  const blocksIn10m = BigInt(Math.round((10 * 60) / cfg.approxBlockSeconds));
  const feats = await computeT10Features(client, {
    token: launch.tokenAddress as Hex,
    liquiditySource: src as Hex,
    fromBlock: launch.launchBlock,
    toBlock: launch.launchBlock + blocksIn10m,
    maxRange: cfg.getLogsMaxRange,
  });

  await prisma.feature.update({
    where: { launchId },
    data: {
      uniqueBuyers10m: feats.uniqueBuyers10m,
      buysPerBuyer10m: feats.buysPerBuyer10m,
      t10ComputedAt: new Date(),
    },
  });
}

export function startFeaturesWorker(client: PublicClient): Worker {
  const connection = parseRedisUrl(loadEnv().redisUrl);
  return new Worker(
    QUEUE_NAMES.features,
    async (job) => {
      if (job.name === 't10') {
        await runT10ForLaunch(client, job.data.launchId as string);
      }
    },
    { connection },
  );
}
