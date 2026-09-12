/**
 * M7 — apps/api's own env loader. Deliberately small: the API only ever reads
 * (Prisma) or does light, occasional read-only RPC (the proof endpoint's
 * on-chain confirmation) — it never signs, commits, or spends. No secret keys
 * belong here.
 */
export interface ApiEnv {
  rpcUrl: string;
  chainId: number;
  commitRegistryAddress?: `0x${string}`;
  /** comma-separated keys that identify a design partner (spec §9) */
  designPartnerApiKeys: string[];
  /** where the worker's periodic scorer writes the benchmark snapshot (M7) */
  benchmarkFile: string;
  revenueAddress?: `0x${string}`;
  priceDeepdiveUsdg: number;
}

export function loadApiEnv(): ApiEnv {
  return {
    rpcUrl: process.env.RH_RPC_URL ?? '',
    chainId: Number(process.env.CHAIN_ID || 4663),
    commitRegistryAddress: (process.env.COMMIT_REGISTRY_ADDRESS || undefined) as
      | `0x${string}`
      | undefined,
    designPartnerApiKeys: (process.env.DESIGN_PARTNER_API_KEYS ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    benchmarkFile: process.env.BENCHMARK_FILE || 'data/benchmark.json',
    revenueAddress: (process.env.REVENUE_ADDRESS || undefined) as `0x${string}` | undefined,
    priceDeepdiveUsdg: Number(process.env.PRICE_DEEPDIVE_USDG || 0.1),
  };
}
