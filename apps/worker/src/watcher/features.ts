import { getLogsChunked } from '@launch-auditor/chain';
import { erc20Abi, type Hex, type PublicClient } from 'viem';
import type { LogClient } from './detect';
import { TRANSFER_TOPIC0, addressToTopic, topicToAddress } from './erc20';

// ── Index lane (spec §3.3 items 1, 2, 8) — computed immediately ─────────

export interface IndexFeatures {
  creatorDevbuyPct: number | null; // item 2: creator's share bought in the launch tx
  hasX: boolean | null; // item 8: presence only — needs launchpad metadata, deferred
  hasSite: boolean | null;
}

export type ReceiptClient = Pick<
  PublicClient,
  'getTransactionReceipt' | 'readContract'
>;

export async function computeIndexFeatures(
  client: ReceiptClient,
  token: Hex,
  creator: Hex,
  launchTxHash: Hex,
): Promise<IndexFeatures> {
  let creatorDevbuyPct: number | null = null;
  try {
    const receipt = await client.getTransactionReceipt({ hash: launchTxHash });
    let received = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== token.toLowerCase()) continue;
      if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC0 || log.topics.length < 3) continue;
      if (topicToAddress(log.topics[2] as string) !== creator.toLowerCase()) continue;
      if (log.data && log.data !== '0x') received += BigInt(log.data);
    }
    const totalSupply = (await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'totalSupply',
    })) as bigint;
    if (totalSupply > 0n) {
      creatorDevbuyPct = Number((received * 1_000_000n) / totalSupply) / 10_000;
    }
  } catch {
    // leave null; refined on the qualified lane / M2
  }
  return { creatorDevbuyPct, hasX: null, hasSite: null };
}

// ── T+10m lane (spec §3.3 item 6) — via a delayed job ──────────────────
// Items 4, 5 (cluster) and 7 (liquidity USD / sell impact) land in M2.

export interface T10Features {
  uniqueBuyers10m: number | null;
  buysPerBuyer10m: number | null;
}

/**
 * A correctly-classified new token has hundreds of transfers in 10 min, not
 * tens of thousands. Blowing past this cap almost always means `tokenAddress`
 * is actually a quote asset — bail rather than page through it.
 */
export const MAX_T10_LOGS = 8000;

export interface T10Params {
  token: Hex;
  /** v2/v3 pool contract, or the v4 PoolManager — the address tokens leave on a buy. */
  liquiditySource: Hex;
  fromBlock: bigint;
  toBlock: bigint;
  maxRange: number;
}

export async function computeT10Features(
  client: LogClient,
  p: T10Params,
): Promise<T10Features> {
  try {
    const logs = await getLogsChunked(client, {
      address: p.token,
      topics: [TRANSFER_TOPIC0 as Hex, addressToTopic(p.liquiditySource)],
      fromBlock: p.fromBlock,
      toBlock: p.toBlock,
      maxRange: p.maxRange,
    });
    if (logs.length > MAX_T10_LOGS) {
      // token is almost certainly a misclassified quote asset
      return { uniqueBuyers10m: null, buysPerBuyer10m: null };
    }
    // Transfers where from == liquiditySource == tokens flowing to a buyer.
    const buyers = new Map<string, number>();
    for (const log of logs) {
      const toTopic = log.topics[2];
      if (!toTopic) continue;
      const to = topicToAddress(toTopic);
      buyers.set(to, (buyers.get(to) ?? 0) + 1);
    }
    if (buyers.size === 0) return { uniqueBuyers10m: 0, buysPerBuyer10m: 0 };
    let totalBuys = 0;
    for (const n of buyers.values()) totalBuys += n;
    return {
      uniqueBuyers10m: buyers.size,
      buysPerBuyer10m: totalBuys / buyers.size,
    };
  } catch {
    return { uniqueBuyers10m: null, buysPerBuyer10m: null };
  }
}
