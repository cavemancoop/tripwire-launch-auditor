import { classifyRpcError, rpcErrorKinds } from '@launch-auditor/rpc-budget';
import {
  decodeFunctionResult,
  encodeFunctionData,
  numberToHex,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';

/**
 * v4 Quoter `quoteExactInputSingle` via eth_call, with the failure taxonomy M4
 * needs: a plain revert is a real signal (the pool won't let you sell), a
 * missing-archive-state / network error is NOT — it means "unresolvable", never
 * "impaired".
 */
const QUOTER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export interface PoolKey {
  currency0: Hex;
  currency1: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
}

export type QuoteError = 'revert' | 'archive' | 'network';

export type QuoteOutcome =
  | { ok: true; amountOut: bigint }
  | { ok: false; error: QuoteError; message: string };

/**
 * Review 896555be: the quoter's mapping of the shared RPC taxonomy, read over the
 * whole error (details, names, causes; never the URL). A transport failure wins
 * over everything, as the old message regex did, so an archive miss with a timed-
 * out cause is `network` (the sweep defers it) rather than a terminal `archive`.
 * So does a rate limit beside an archive miss: an `archive` result is terminal on
 * its first attempt, and a 429 nested under "header not found" is the provider
 * refusing, not the node lacking state. A revert still wins over a bare rate-limit
 * signal: `revert` prices DRAWDOWN_80's horizon at 0, and a revert reason that
 * mentions a rate limit (or revert data with `429` in its hex) is still the pool
 * refusing the sell. Anything else is `network`, never a signal.
 */
export function classifyQuoteError(err: unknown): QuoteError {
  const kinds = rpcErrorKinds(err);
  if (kinds.includes('quota') || kinds.includes('transport')) return 'network';
  if (kinds.includes('archive')) return kinds.includes('rate_limit') ? 'network' : 'archive';
  if (kinds.includes('revert')) return 'revert';
  return 'network';
}

export async function quoteExactInSingle(args: {
  client: Pick<PublicClient, 'request'>;
  quoter: Hex;
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  blockNumber?: bigint;
}): Promise<QuoteOutcome> {
  const data = encodeFunctionData({
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: args.poolKey, zeroForOne: args.zeroForOne, exactAmount: args.amountIn, hookData: '0x' }],
  });
  const blockTag = args.blockNumber !== undefined ? numberToHex(args.blockNumber) : 'latest';
  try {
    const res = (await args.client.request({
      method: 'eth_call',
      params: [{ to: args.quoter, data }, blockTag],
    })) as Hex;
    const [amountOut] = decodeFunctionResult({
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      data: res,
    }) as readonly [bigint, bigint];
    return { ok: true, amountOut };
  } catch (err) {
    // Package 4a: a provider quota outage is not a quote result of any kind.
    // Propagate it whole so the sweep defers the row with its give-up clock paused.
    if (classifyRpcError(err) === 'quota') throw err;
    return {
      ok: false,
      error: classifyQuoteError(err),
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** currency0/currency1 ordering + zeroForOne for selling `token` into `quote`. */
export function sellDirection(token: string, quote: string): { zeroForOne: boolean } {
  return { zeroForOne: token.toLowerCase() < quote.toLowerCase() };
}
