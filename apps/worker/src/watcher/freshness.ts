import type { BlockscoutClient } from '@launch-auditor/chain';

/**
 * A fresh Uniswap pool is not the same thing as a new token launch: someone can
 * create a brand-new pool for two assets that have both existed for months
 * (e.g. a tokenized-stock / USDG pair getting a new fee tier). Spec §0 is about
 * *new token launches* — so before indexing a detected pool as a launch, check
 * whether its classified "token" side was actually just deployed.
 *
 * Method: Blockscout already indexes each contract's creation tx regardless of
 * RPC node pruning (staying inside the index lane's RPC+Blockscout-only rule,
 * spec §3.1). If the token's creation predates the pool by more than the fresh
 * window, it's not a launch. If Blockscout can't say (API hiccup, not indexed
 * yet), default to treating it as fresh — a long-established token (the case
 * we're guarding against) is essentially always resolvable; only a genuinely
 * brand-new one is ever ambiguous, and "index it" is the right call for that.
 */
export const FRESH_LAUNCH_WINDOW_BLOCKS = 36_000n; // ~1h at chain 4663's ~0.1s blocks

export type FreshnessReason = 'fresh' | 'preexisting' | 'inconclusive';

export interface FreshnessCheck {
  isFreshLaunch: boolean;
  tokenCreationBlock: bigint | null;
  ageBlocksAtPool: bigint | null;
  reason: FreshnessReason;
}

export type FreshnessBlockscout = Pick<BlockscoutClient, 'getAddress' | 'getTransaction'>;

export async function checkTokenFreshness(
  client: FreshnessBlockscout,
  tokenAddress: string,
  poolBlockNumber: bigint,
  windowBlocks: bigint = FRESH_LAUNCH_WINDOW_BLOCKS,
): Promise<FreshnessCheck> {
  const inconclusive: FreshnessCheck = {
    isFreshLaunch: true,
    tokenCreationBlock: null,
    ageBlocksAtPool: null,
    reason: 'inconclusive',
  };

  try {
    const addr = await client.getAddress(tokenAddress);
    const creationTxHash = addr.creation_transaction_hash;
    if (!creationTxHash) return inconclusive;

    const tx = await client.getTransaction(creationTxHash);
    if (tx.block_number === null || tx.block_number === undefined) return inconclusive;

    const creationBlock = BigInt(tx.block_number);
    const ageBlocksAtPool = poolBlockNumber > creationBlock ? poolBlockNumber - creationBlock : 0n;

    if (ageBlocksAtPool > windowBlocks) {
      return { isFreshLaunch: false, tokenCreationBlock: creationBlock, ageBlocksAtPool, reason: 'preexisting' };
    }
    return { isFreshLaunch: true, tokenCreationBlock: creationBlock, ageBlocksAtPool, reason: 'fresh' };
  } catch {
    return inconclusive;
  }
}
