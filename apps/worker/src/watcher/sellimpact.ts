import {
  decodeFunctionResult,
  encodeFunctionData,
  numberToHex,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';

// Our own quote-based sell impact (spec §3.3.7 / §3.3.9): eth_call the v4 Quoter
// with a fixed-size sell and compare the effective price to a near-spot quote.
// No fork. v4 only for now (v3 is barely used on 4663).

const QUOTER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export interface SellImpactParams {
  client: Pick<PublicClient, 'request'>;
  quoter: Hex;
  token: Hex;
  quote: Hex; // the paired asset
  fee: number;
  tickSpacing: number;
  hooks: Hex;
  totalSupply: bigint;
  blockNumber?: bigint;
}

export interface SellImpactResult {
  sellImpactBps: number | null;
  sellSimOk: boolean | null; // did a fixed-size sell simulate at all
  /** the fixed sell size used (0.1% of total supply) */
  sellSizeTokens: bigint;
}

export async function quoteSellImpact(p: SellImpactParams): Promise<SellImpactResult> {
  const c0 = (
    p.token.toLowerCase() < p.quote.toLowerCase() ? p.token : p.quote
  ).toLowerCase() as Hex;
  const c1 = (
    p.token.toLowerCase() < p.quote.toLowerCase() ? p.quote : p.token
  ).toLowerCase() as Hex;
  const zeroForOne = p.token.toLowerCase() === c0; // selling the token: token -> other

  const poolKey = {
    currency0: c0,
    currency1: c1,
    fee: p.fee,
    tickSpacing: p.tickSpacing,
    hooks: (p.hooks || '0x0000000000000000000000000000000000000000') as Hex,
  };

  const bulk = p.totalSupply / 1000n; // 0.1% of supply
  const spot = bulk / 1000n > 0n ? bulk / 1000n : 1n; // ~0.0001% — near-spot reference
  const empty: SellImpactResult = {
    sellImpactBps: null,
    sellSimOk: null,
    sellSizeTokens: bulk,
  };
  if (bulk === 0n) return empty;

  const encode = (exactAmount: bigint): Hex =>
    encodeFunctionData({
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey, zeroForOne, exactAmount, hookData: '0x' }],
    });
  const blockTag = p.blockNumber !== undefined ? numberToHex(p.blockNumber) : 'latest';

  const call = async (exactAmount: bigint): Promise<bigint | null> => {
    try {
      const res = (await p.client.request({
        method: 'eth_call',
        params: [{ to: p.quoter, data: encode(exactAmount) }, blockTag],
      })) as Hex;
      const [out] = decodeFunctionResult({
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        data: res,
      }) as readonly [bigint, bigint];
      return out;
    } catch {
      return null; // quoter reverted
    }
  };

  const [outSpot, outBulk] = await Promise.all([call(spot), call(bulk)]);

  if (outSpot === null || outSpot === 0n) {
    return { ...empty, sellSimOk: false };
  }
  if (outBulk === null || outBulk === 0n) {
    // spot quote worked but the size sell reverted / returned nothing
    return { ...empty, sellSimOk: false };
  }

  const spotPer = Number(outSpot) / Number(spot);
  const bulkPer = Number(outBulk) / Number(bulk);
  const impact = Math.round((1 - bulkPer / spotPer) * 10_000);
  return {
    sellImpactBps: Math.max(0, impact),
    sellSimOk: true,
    sellSizeTokens: bulk,
  };
}
