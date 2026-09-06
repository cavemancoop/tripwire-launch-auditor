import { getChainConfig, getGetLogsMaxRange } from '@launch-auditor/chain';
import { Prisma, prisma } from '@launch-auditor/db';
import { Worker } from 'bullmq';
import { erc20Abi, type Hex, type PublicClient } from 'viem';
import { computeTokenAgeAtPool } from './freshness';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const decimalsCache = new Map<string, number>();

/** decimals of the quote asset, for the §8.4 sell notionals. Cached; 18 on failure. */
async function readQuoteDecimals(
  client: Pick<PublicClient, 'readContract'>,
  quote: string | null,
): Promise<number> {
  if (!quote || quote.toLowerCase() === ZERO_ADDR) return 18;
  const key = quote.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const d = Number(
      await client.readContract({ address: quote as Hex, abi: erc20Abi, functionName: 'decimals' }),
    );
    decimalsCache.set(key, d);
    return d;
  } catch {
    decimalsCache.set(key, 18);
    return 18;
  }
}
import { loadEnv } from '../env';
import { QUEUE_NAMES, parseRedisUrl } from '../queues';
import { buildLaunchReports, persistLaunchReports } from '../report';
import { buildCreatorCluster, clusterAddresses } from './cluster';
import { computeCreatorContext } from './creator';
import { computeFeature9 } from './feature9';
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
    maxRange: getGetLogsMaxRange(launch.chainId),
  });

  // §3.2 — creator cluster (rules 1-3; rule 4 no-op until an index is wired)
  const cluster = await buildCreatorCluster({
    client,
    token,
    creator,
    liquiditySource,
    launchBlock: launch.launchBlock,
    windowBlocks: blocksIn10m,
    maxRange: getGetLogsMaxRange(launch.chainId),
  });

  // item 3 — creator context. Prior-launch counts refresh every run (cheap DB);
  // the age nonce-search runs only when not already known (1-6s/RPC-call).
  const existing = await prisma.feature.findUnique({
    where: { launchId },
    select: { creatorAgeDays: true },
  });

  // checkpoint §8.6 — token code age at pool creation (archive getCode search,
  // off the poller). Skip when already known.
  if (launch.tokenAgeAtPoolSec === null) {
    const age = await computeTokenAgeAtPool(
      client,
      token,
      launch.launchBlock,
      cfg.approxBlockSeconds,
    );
    if (age.ageSec !== null) {
      await prisma.launch.update({
        where: { id: launchId },
        data: { tokenAgeAtPoolSec: age.ageSec },
      });
    }
  }
  const creatorCtx = await computeCreatorContext({
    client,
    chainId: launch.chainId,
    creator: creator as Hex,
    launchBlock: launch.launchBlock,
    launchId,
    approxBlockSeconds: cfg.approxBlockSeconds,
    existingAgeDays: existing?.creatorAgeDays ?? null,
  });

  // items 4, 5 — cluster / top-10 supply concentration at T+10m
  const holders = await computeHolderStats({
    logClient: client,
    readClient: client,
    token,
    fromBlock,
    toBlock,
    maxRange: getGetLogsMaxRange(launch.chainId),
    creator,
    cluster: clusterAddresses(cluster),
    liquiditySource,
  });

  // feature 9 (§3.3.9) + feature 7 sell impact — qualified lane, non-launchpad only
  const env = loadEnv();
  const qualified =
    !launch.lpLockedByConstruction &&
    (feats.uniqueBuyers10m ?? 0) >= env.qualifyUniqueBuyers;
  const f9 = qualified
    ? await computeFeature9({
        client,
        token,
        quote: (launch.quoteAddress as Hex | null) ?? null,
        quoter: cfg.uniswap.v4Quoter.address as Hex,
        poolFee: launch.poolFee,
        poolTickSpacing: launch.poolTickSpacing,
        poolHooks: launch.poolHooks,
        quoteDecimals: await readQuoteDecimals(client, launch.quoteAddress),
        blockNumber: toBlock,
        goplus: { apiKey: env.goplusApiKey },
        scanhood: { baseUrl: env.scanhoodApiBase },
      })
    : null;

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
    prisma.launch.update({
      where: { id: launchId },
      data: { lane: qualified ? 'qualified' : undefined },
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
        ...(f9
          ? {
              verified: f9.verified,
              ownerRenounced: f9.ownerRenounced,
              mintable: f9.mintable,
              lpHolderType: f9.lpHolderType,
              sellSimOk: f9.sellSimOk,
              sellTaxBps: f9.sellTaxBps,
              sellImpactBps: f9.sellImpactBps,
              sellImpactBps100: f9.sellImpactBps100,
              sellImpactBps1000: f9.sellImpactBps1000,
              liquidityUsd10m: f9.liquidityUsd10m,
              goplusRaw: f9.goplusRaw as Prisma.InputJsonValue,
              goplusFetchedAt: f9.goplusFetchedAt,
              scanhoodRaw: f9.scanhoodRaw as Prisma.InputJsonValue,
              scanhoodFetchedAt: f9.scanhoodFetchedAt,
            }
          : {}),
        // leave t10ComputedAt null when the cluster lookups were incomplete, so a
        // re-run finishes it (rather than freezing a partial feature vector)
        t10ComputedAt: cluster.partial.length === 0 ? new Date() : null,
      },
    }),
  ]);

  // §6/§8.3 — assemble, sign and validate det_v0 + heuristic_v1 reports once the
  // feature vector is complete. The commit job (M3d) posts the passing ones.
  if (cluster.partial.length === 0) {
    try {
      const drafts = await buildLaunchReports(client, launchId, 'launch');
      const r = await persistLaunchReports(drafts);
      if (r.failed > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[t10] ${launchId}: ${r.failed}/${r.stored} reports failed the validator`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[t10] ${launchId}: report assembly failed`, err instanceof Error ? err.message : err);
    }
  }
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
