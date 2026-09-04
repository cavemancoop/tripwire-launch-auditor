import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface WorkerEnv {
  chainId: number;
  rpcUrl: string;
  archiveRpcUrl: string;
  redisUrl: string;
  pollIntervalMs: number;
  quotaPerCreator24h: number;
  /** blocks behind head to treat as settled (reorg + load-balanced-RPC lag buffer) */
  headLagBlocks: bigint;
  /** max blocks advanced per poll, so a big catch-up is chunked with cursor saves */
  maxSpanBlocks: bigint;
}

let dotenvLoaded = false;

/**
 * Load the repo-root `.env` into `process.env`, once per process. Nothing here
 * was doing this before — every script just read `process.env` directly, which
 * only worked when whatever shell launched it happened to already have those
 * variables (a terminal profile, a prior `dotenv`-aware command, etc). That's
 * not something to depend on: a genuinely fresh shell, CI, or a differently
 * configured machine gets "RH_RPC_URL is not set" even with a real `.env` on
 * disk. `pnpm --filter` runs each script with cwd set to that package's own
 * directory, so walk up looking for `.env` rather than assuming the repo root.
 * Uses Node's built-in loader (stable since v20.12/v21.7), which — like
 * dotenv — never overrides a variable already set in the real environment
 * (so Railway/production env vars always win over any stray `.env`).
 */
function ensureDotenvLoaded(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // malformed .env — fall through and use whatever process.env already has
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function loadEnv(): WorkerEnv {
  ensureDotenvLoaded();
  const rpcUrl = process.env.RH_RPC_URL ?? '';
  return {
    chainId: Number(process.env.CHAIN_ID ?? 4663),
    rpcUrl,
    archiveRpcUrl: process.env.RH_RPC_ARCHIVE_URL || rpcUrl,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    pollIntervalMs: Number(process.env.WATCHER_POLL_INTERVAL_MS ?? 2000),
    quotaPerCreator24h: Number(process.env.QUOTA_PER_CREATOR_24H ?? 5),
    headLagBlocks: BigInt(process.env.WATCHER_HEAD_LAG_BLOCKS ?? 60),
    maxSpanBlocks: BigInt(process.env.WATCHER_MAX_SPAN_BLOCKS ?? 4000),
  };
}
