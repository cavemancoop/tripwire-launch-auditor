export interface WorkerEnv {
  chainId: number;
  rpcUrl: string;
  archiveRpcUrl: string;
  redisUrl: string;
  pollIntervalMs: number;
  quotaPerCreator24h: number;
  /** blocks behind head to treat as final (reorg buffer) */
  headLagBlocks: bigint;
}

export function loadEnv(): WorkerEnv {
  const rpcUrl = process.env.RH_RPC_URL ?? '';
  return {
    chainId: Number(process.env.CHAIN_ID ?? 4663),
    rpcUrl,
    archiveRpcUrl: process.env.RH_RPC_ARCHIVE_URL || rpcUrl,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    pollIntervalMs: Number(process.env.WATCHER_POLL_INTERVAL_MS ?? 2000),
    quotaPerCreator24h: Number(process.env.QUOTA_PER_CREATOR_24H ?? 5),
    headLagBlocks: BigInt(process.env.WATCHER_HEAD_LAG_BLOCKS ?? 2),
  };
}
