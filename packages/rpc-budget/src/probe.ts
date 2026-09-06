import { numberToHex } from 'viem';

export interface ProbeOptions {
  /** a contract address with plenty of logs (e.g. the v4 PoolManager) */
  address: string;
  /** recent block to anchor the probe window at (usually head - a few) */
  anchorBlock: bigint;
  /** spans to try, largest first; first that the RPC accepts wins */
  candidates?: number[];
}

/** ordofi rejects an over-wide eth_getLogs with a range/limit message. */
const RANGE_ERROR =
  /range|block range|too (large|many|wide)|exceed|limit|max.*block|-32701|-32005|10000|20000/i;

type RequestFn = (args: { method: string; params: unknown[] }) => Promise<unknown>;

/**
 * Find the largest eth_getLogs block span this RPC will answer. Returns a number
 * of blocks; the watcher and backfill chunk their scans at that size. On a
 * non-range error (network/timeout) it returns the smallest candidate rather
 * than guessing high.
 */
export async function probeGetLogsRange(request: RequestFn, opts: ProbeOptions): Promise<number> {
  const candidates = (opts.candidates ?? [20_000, 10_000, 5_000, 2_000, 1_000]).slice().sort(
    (a, b) => b - a,
  );
  const safest = candidates[candidates.length - 1] ?? 2_000;

  for (const span of candidates) {
    const from = opts.anchorBlock - BigInt(span) + 1n;
    try {
      await request({
        method: 'eth_getLogs',
        params: [
          {
            address: opts.address,
            fromBlock: numberToHex(from < 0n ? 0n : from),
            toBlock: numberToHex(opts.anchorBlock),
          },
        ],
      });
      return span;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (RANGE_ERROR.test(msg)) continue;
      return safest;
    }
  }
  return safest;
}
