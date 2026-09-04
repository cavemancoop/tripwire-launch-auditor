import { attributeSource, getChainConfig } from '@launch-auditor/chain';
import { prisma } from '@launch-auditor/db';
import type { Hex, PublicClient } from 'viem';
import { getQueues, T10_DELAY_MS } from '../queues';
import { classifyPair } from './classify';
import type { DetectedPool } from './detect';
import { computeIndexFeatures } from './features';
import { checkTokenFreshness } from './freshness';
import { creatorQuotaExceeded } from './quota';
import { withRetry } from './retry';

export interface IngestDeps {
  client: PublicClient;
  chainId: number;
  quotaPerCreator24h: number;
  /** override the T+10m enqueue (tests) */
  enqueueT10?: (launchId: string) => Promise<void>;
}

/** Address that tokens leave on a buy: v4 PoolManager, else the pool contract. */
export function liquiditySource(chainId: number, dp: DetectedPool): Hex {
  if (dp.poolCreation.poolKind === 'v4') {
    return getChainConfig(chainId).uniswap.v4PoolManager.address as Hex;
  }
  return dp.poolCreation.poolAddress as Hex;
}

/**
 * Persist one detected pool as a `launches` row (index lane): attribute the
 * launchpad, resolve the creator, run the per-creator quota, compute the
 * immediate index-lane features, and enqueue the T+10m job.
 * Returns the launch id, or null if it was already indexed.
 */
export async function ingestPool(
  dp: DetectedPool,
  deps: IngestDeps,
): Promise<string | null> {
  const { client, chainId, quotaPerCreator24h } = deps;
  const { poolCreation: pc, txHash, blockNumber } = dp;

  const { token, quote, confident } = classifyPair(chainId, pc.token0, pc.token1);

  const existing = await prisma.launch.findUnique({
    where: { chainId_tokenAddress: { chainId, tokenAddress: token } },
  });
  if (existing) return null;

  // A new pool isn't the same thing as a new token launch: two long-established
  // assets (e.g. a tokenized stock / USDG pair) can get a fresh pool. Only index
  // this as a launch if the token side was actually just deployed.
  const freshness = await checkTokenFreshness(client, token as Hex, blockNumber);
  if (!freshness.isFreshLaunch) {
    // eslint-disable-next-line no-console
    console.log(
      `[watcher] skipping ${token} at block ${blockNumber}: not a new-token launch ` +
        `(had code by block ${freshness.checkedAtBlock}, tx ${txHash})`,
    );
    return null;
  }

  // A just-seen tx/block can read back as "not found" from a lagging RPC node
  // (load balancing) or a shallow reorg — retry with backoff before giving up.
  const [tx, receipt, block] = await withRetry(() =>
    Promise.all([
      client.getTransaction({ hash: txHash as Hex }),
      client.getTransactionReceipt({ hash: txHash as Hex }),
      client.getBlock({ blockNumber }),
    ]),
  );

  const creator = tx.from;
  const touched = new Set<string>([
    tx.to ?? '',
    ...receipt.logs.map((l) => l.address),
  ]);
  const attribution = attributeSource(chainId, touched);

  const launchAt = new Date(Number(block.timestamp) * 1000);
  const quotaExceeded = await creatorQuotaExceeded(
    chainId,
    creator,
    launchAt,
    quotaPerCreator24h,
  );

  const idx = await computeIndexFeatures(client, token as Hex, creator as Hex, txHash as Hex);

  const launch = await prisma.launch.create({
    data: {
      chainId,
      source: attribution.source,
      sourceConfidence: attribution.sourceConfidence,
      lpLockedByConstruction: attribution.lpLockedByConstruction,
      tokenAddress: token,
      quoteAddress: quote ?? undefined,
      poolKind: pc.poolKind,
      poolAddress: pc.poolAddress ?? undefined,
      poolId: pc.poolId ?? undefined,
      creatorAddress: creator,
      launchBlock: blockNumber,
      launchTxHash: txHash,
      launchAt,
      detectedVia: pc.detectedVia,
      lane: 'index',
      quotaExceeded,
      feature: {
        create: {
          schemaVersion: 'v0',
          creatorDevbuyPct: idx.creatorDevbuyPct,
          hasX: idx.hasX,
          hasSite: idx.hasSite,
          indexLaneComputedAt: new Date(),
          provenance: {
            source: {
              via: pc.detectedVia,
              block: Number(blockNumber),
              matchedAddress: attribution.matchedAddress,
              viaCandidate: attribution.viaCandidate,
            },
            pairClassification: { token, quote, confident },
            // bigints aren't valid JSON — narrow to a number for storage
            tokenFreshness: {
              isFreshLaunch: freshness.isFreshLaunch,
              reason: freshness.reason,
              checkedAtBlock: Number(freshness.checkedAtBlock),
            },
            creatorDevbuyPct: { launchTx: txHash },
          },
        },
      },
    },
  });

  if (deps.enqueueT10) {
    await deps.enqueueT10(launch.id);
  } else {
    await getQueues().features.add(
      't10',
      { launchId: launch.id },
      { delay: T10_DELAY_MS, jobId: `t10-${launch.id}`, removeOnComplete: true },
    );
  }

  return launch.id;
}
