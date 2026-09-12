/**
 * M7 — apps/api's own env loader. Deliberately small: the API only ever reads
 * (Prisma) or does light, occasional read-only RPC (the proof endpoint's
 * on-chain confirmation) — it never signs, commits, or spends. No secret keys
 * belong here.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Walk up from `startDir` for the workspace root. `pnpm --filter X start` sets
 * cwd to that package's own directory, so a bare relative default like
 * `data/benchmark.json` would resolve differently in the API than in the
 * worker that writes it (`apps/worker/src/scorer/loop.ts` has the same
 * helper, duplicated rather than shared across an app/app boundary).
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

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
    benchmarkFile:
      process.env.BENCHMARK_FILE || join(findRepoRoot(process.cwd()), 'data', 'benchmark.json'),
    revenueAddress: (process.env.REVENUE_ADDRESS || undefined) as `0x${string}` | undefined,
    priceDeepdiveUsdg: Number(process.env.PRICE_DEEPDIVE_USDG || 0.1),
  };
}
