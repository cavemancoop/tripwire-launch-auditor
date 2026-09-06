import { newCoverage } from './coverage';
import { quoteExactInSingle, sellDirection } from './quote';
import { notApplicable, resolved, unresolvable, type Resolution } from './types';
import type { ResolverContext } from './context';

const TAX_FLOOR = 0.3; // effective sell tax >= 30% => impaired

/**
 * SELL_IMPAIRED (spec §1): a fixed-size sell simulation reverts, or effective
 * sell tax >= 30%, at the horizon block. Fixed size = 100 units of the paired
 * asset's worth of the token (100 USDG for USDG pools), priced off a tiny spot
 * quote (checkpoint §8.4, RPC-only). Archive/network failure => UNRESOLVABLE,
 * never false (checkpoint §C step 2).
 */
export async function resolveSellImpaired(ctx: ResolverContext): Promise<Resolution> {
  if (ctx.lpLockedByConstruction) return notApplicable('launchpad token: LP locked by construction');
  const coverage = newCoverage(ctx.horizonBlock, ctx.horizonBlock, 0);

  if (!ctx.poolKey) {
    coverage.gaps.push('non-v4 pool; sell-impact quote not wired');
    return unresolvable('sell-impact quote only implemented for v4 pools', coverage);
  }

  const quoter = ctx.quoter as `0x${string}`;
  const { zeroForOne } = sellDirection(ctx.token, ctx.quote);
  const spotIn = 10n ** 12n;

  const spot = await quoteExactInSingle({
    client: ctx.client,
    quoter,
    poolKey: ctx.poolKey,
    zeroForOne,
    amountIn: spotIn,
    blockNumber: ctx.horizonBlock,
  });
  coverage.callCount += 1;
  if (!spot.ok) {
    if (spot.error === 'revert') {
      return resolved(true, { reason: 'spot sell quote reverts', horizonBlock: Number(ctx.horizonBlock) }, coverage);
    }
    return unresolvable(`spot quote ${spot.error} at horizon block`, coverage);
  }
  if (spot.amountOut === 0n) {
    return resolved(true, { reason: 'spot sell quote returns 0', horizonBlock: Number(ctx.horizonBlock) }, coverage);
  }

  const notionalQuoteRaw = 100n * 10n ** BigInt(ctx.quoteDecimals);
  const sellSize = (notionalQuoteRaw * spotIn) / spot.amountOut; // token raw units ~= 100 quote units worth
  if (sellSize <= 0n) {
    coverage.notes.push('computed sell size rounded to 0; token likely very high unit price');
    return unresolvable('sell size underflow', coverage);
  }

  const bulk = await quoteExactInSingle({
    client: ctx.client,
    quoter,
    poolKey: ctx.poolKey,
    zeroForOne,
    amountIn: sellSize,
    blockNumber: ctx.horizonBlock,
  });
  coverage.callCount += 1;
  if (!bulk.ok) {
    if (bulk.error === 'revert') {
      return resolved(true, { reason: '100-unit sell quote reverts', sellSizeTokens: sellSize.toString() }, coverage);
    }
    return unresolvable(`bulk quote ${bulk.error} at horizon block`, coverage);
  }
  if (bulk.amountOut === 0n) {
    return resolved(true, { reason: '100-unit sell quote returns 0', sellSizeTokens: sellSize.toString() }, coverage);
  }

  const spotPer = Number(spot.amountOut) / Number(spotIn);
  const bulkPer = Number(bulk.amountOut) / Number(sellSize);
  const tax = Math.max(0, 1 - bulkPer / spotPer);

  return resolved(tax >= TAX_FLOOR, {
    notionalQuoteUnits: 100,
    quoteAsset: ctx.quote,
    quoteDecimals: ctx.quoteDecimals,
    sellSizeTokens: sellSize.toString(),
    spotPer,
    bulkPer,
    taxBps: Math.round(tax * 10_000),
    horizonBlock: Number(ctx.horizonBlock),
  }, coverage);
}
