import { numberToHex, type Address, type Hex, type PublicClient } from 'viem';

export interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  logIndex: Hex;
  removed: boolean;
}

export interface ChunkedLogsParams {
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock: bigint;
  toBlock: bigint;
  /** Max blocks per eth_getLogs call (RPC range limit; 2000 for ordofi). */
  maxRange: number;
}

/**
 * eth_getLogs split into <= maxRange-block windows so it stays under the RPC's
 * range limit. Returns raw RPC logs in block order.
 */
export async function getLogsChunked(
  client: Pick<PublicClient, 'request'>,
  params: ChunkedLogsParams,
): Promise<RpcLog[]> {
  const { address, topics, fromBlock, toBlock, maxRange } = params;
  if (maxRange < 1) throw new Error('maxRange must be >= 1');

  const out: RpcLog[] = [];
  const step = BigInt(maxRange);
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = start + step - 1n < toBlock ? start + step - 1n : toBlock;
    const batch = (await client.request({
      method: 'eth_getLogs',
      params: [
        {
          address,
          topics,
          fromBlock: numberToHex(start),
          toBlock: numberToHex(end),
        },
      ],
    })) as unknown as RpcLog[];
    out.push(...batch);
  }
  return out;
}

export const hexToBigInt = (h: Hex): bigint => BigInt(h);
