import { getChainConfig } from '@launch-auditor/chain';
import { prisma } from '@launch-auditor/db';
import { Worker } from 'bullmq';
import type { Hex, PublicClient } from 'viem';
import { loadEnv } from '../env';
import { QUEUE_NAMES, parseRedisUrl } from '../queues';
import { buildCreatorCluster, clusterAddresses } from './cluster';
import { computeCreatorContext } from './creator';
import { computeT10Features } from './features';
import { computeHolderStats } from './holders';

/**
 * T+10m feature pass for one launch (spec §3.3 items 4, 5, 6):
 * buyers (item 6), then the creator cluster (§3.2) and the cluster / top-10
 * supply concentration it feeds (items 4, 5).
 */
export async function runT10ForLaunch(
  client: PublicClient,
  launchId: string,
): Promise<void> {
  const launch = await prisma.launch.findUnique({ where: { id: launchId } });
  if (!launch) return;

  const cfg = getChainConfig(launch.chainId);
  const src =
    launch.poolKind === 'v4' ? cfg.uniswap.v4PoolManager.address : launch.poolAddress;
  if (!src) return;
  const liquiditySource = src.toLowerCase();

  const blocksIn10m = BigInt(Math.round((10 * 60) / cfg.approxBlockSeconds));
  const fromBlock = launch.launchBlock;
  const toBlock = launch.launchBlock + blocksIn10m;
  const token = launch.tokenAddress as Hex;
  const creator = launch.creatorAddress;

  // item 6 — buyers
  const feats = await computeT10Features(client, {
    token,
    liquiditySource: liquiditySource as Hex,
    fromBlock,
    toBlock,
    maxRange: cfg.getLogsMaxRange,
  });

  // §3.2 — creator cluster (rules 1-3; rule 4 no-op until an index is wired)
  const cluster = await buildCreatorCluster({
    client,
    token,
    creator,
    liquiditySource,
    launchBlock: launch.launchBlock,
    windowBlocks: blocksIn10m,
    maxRange: cfg.getLogsMaxRange,
  });

  // item 3 — creator context (also refreshed here so a re-run / backfill fills it)
  const creatorCtx = await computeCreatorContext({
    client,
    chainId: launch.chainId,
    creator: creator as Hex,
    launchBlock: launch.launchBlock,
    launchId,
    approxBlockSeconds: cfg.approxBlockSeconds,
  });

  // items 4, 5 — cluster / top-10 supply concentration at T+10m
  const holders = await computeHolderStats({
    logClient: client,
    readClient: client,
    token,
    fromBlock,
    toBlock,
    maxRange: cfg.getLogsMaxRange,
    creator,
    cluster: clusterAddresses(cluster),
    liquiditySource,
  });

  await prisma.$transaction([
    prisma.clusterMember.deleteMany({ where: { launchId } }),
    prisma.clusterMember.createMany({
      data: cluster.members.map((m) => ({
        launchId,
        address: m.address,
        rule: m.rule,
        evidenceTx: m.evidenceTx,
        confidence: m.confidence,
      })),
    }),
    prisma.feature.update({
      where: { launchId },
      data: {
        uniqueBuyers10m: feats.uniqueBuyers10m,
        buysPerBuyer10m: feats.buysPerBuyer10m,
        creatorAgeDays: creatorCtx.creatorAgeDays,
        creatorPriorLaunches: creatorCtx.creatorPriorLaunches,
        creatorPriorInsiderExitRate: creatorCtx.creatorPriorInsiderExitRate,
        clusterSize: cluster.size,
        clusterConfidence: cluster.confidence,
        clusterSupplyPct: holders.clusterSupplyPct,
        top10NoncreatorPct: holders.top10NoncreatorPct,
        t10ComputedAt: new Date(),
      },
    }),
  ]);
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
