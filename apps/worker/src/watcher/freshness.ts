import type { Address, PublicClient } from 'viem';

/**
 * A fresh Uniswap pool is not the same thing as a new token launch: someone
 * can create a brand-new pool for two assets that have both existed for
 * months (e.g. a tokenized-stock / USDG pair getting a new fee tier). Before
 * indexing a detected pool as a launch, check whether its "token" side
 * already had code well before the pool was created — if so, it's not new.
 *
 * This checks via `eth_getCode` at `poolBlock - windowBlocks`, not Blockscout:
 * Blockscout sits behind Cloudflare and returns 403 to a plain server-side
 * fetch (confirmed directly — a Node client is not a browser), so it cannot
 * be a runtime dependency here even though it's allowed by spec §3.1's
 * "RPC + Blockscout only" rule. Chain 4663's RPC retains full historical
 * state (confirmed: `eth_getCode` resolves correctly across a 54M-block gap),
 * so one `getCode` call settles it with no third-party dependency.
 */
export const FRESH_LAUNCH_WINDOW_BLOCKS = 36_000n; // ~1h at chain 4663's ~0.1s blocks

export type FreshnessReason = 'fresh' | 'preexisting' | 'inconclusive';

export interface FreshnessCheck {
  isFreshLaunch: boolean;
  reason: FreshnessReason;
  checkedAtBlock: bigint;
}

export type FreshnessClient = Pick<PublicClient, 'getCode'>;

export async function checkTokenFreshness(
  client: FreshnessClient,
  tokenAddress: Address,
  poolBlockNumber: bigint,
  windowBlocks: bigint = FRESH_LAUNCH_WINDOW_BLOCKS,
): Promise<FreshnessCheck> {
  const checkedAtBlock = poolBlockNumber > windowBlocks ? poolBlockNumber - windowBlocks : 0n;
  try {
    const code = await client.getCode({ address: tokenAddress, blockNumber: checkedAtBlock });
    const hadCodeAlready = Boolean(code) && code !== '0x';
    return {
      isFreshLaunch: !hadCodeAlready,
      reason: hadCodeAlready ? 'preexisting' : 'fresh',
      checkedAtBlock,
    };
  } catch {
    // RPC couldn't answer for this historical block — don't block indexing on it
    return { isFreshLaunch: true, reason: 'inconclusive', checkedAtBlock };
  }
}
