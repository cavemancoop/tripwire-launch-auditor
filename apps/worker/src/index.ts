import {
  POOL_EVENT_TOPIC0,
  getGetLogsMaxRange,
  poolCreationSources,
  setGetLogsMaxRange,
} from '@launch-auditor/chain';
import { probeGetLogsRange } from '@launch-auditor/rpc-budget';
import type { PublicClient } from 'viem';
import { startAssessWorker } from './assess';
import { runCommitLoop } from './commit';
import { runDeepdiveLoop, startDeepdiveWorker } from './deepdive';
import { loadEnv, type WorkerEnv } from './env';
import { runLifecycleLoop } from './metabolism';
import { runOutcomesLoop } from './outcomes';
import { runScorerLoop } from './scorer';
import { runTelegramPosterLoop } from './telegram/poster';
import { runPoller, type StopSignal } from './watcher/poller';
import { rpc } from './watcher/rpc';
import { startFeaturesWorker } from './watcher/t10';

/**
 * Establish the shared RPC budget before any scanning starts: log the rate, and
 * either pin the eth_getLogs span from env or probe the RPC's real limit once so
 * the watcher and (M4) backfill chunk at the largest size the node accepts.
 */
async function bootRpcBudget(client: PublicClient, env: WorkerEnv): Promise<void> {
  console.log(
    `[rpc-budget] ${env.rpcBudgetRpm} req/min shared · priority watcher>commit>outcomes>deepdive>backfill`,
  );
  if (env.rpcMaxGetLogsRange > 0) {
    setGetLogsMaxRange(env.rpcMaxGetLogsRange);
    console.log(`[rpc-budget] eth_getLogs span pinned to ${env.rpcMaxGetLogsRange} (env)`);
    return;
  }
  try {
    const head = await client.getBlockNumber();
    const { v4PoolManager } = poolCreationSources(env.chainId);
    const probe = probeGetLogsRange(
      (args) => client.request(args as never) as Promise<unknown>,
      {
        address: v4PoolManager,
        anchorBlock: head > 5n ? head - 5n : head,
        candidates: [9_999, 5_000, 2_000],
        topics: [POOL_EVENT_TOPIC0.v4Initialize], // sparse — keep the probe response small
      },
    );
    const timeout = new Promise<number>((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 25_000));
    const span = await Promise.race([probe, timeout]);
    setGetLogsMaxRange(span);
    console.log(`[rpc-budget] probed eth_getLogs span = ${span} blocks`);
  } catch (err) {
    console.warn(
      `[rpc-budget] getLogs range probe failed; using config default ${getGetLogsMaxRange(env.chainId)} —`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function main(): Promise<void> {
  const client = rpc();
  const env = loadEnv();
  const signal: StopSignal = { stopped: false };

  await bootRpcBudget(client, env);

  const worker = startFeaturesWorker(client);
  worker.on('ready', () => console.log('[worker] features queue ready'));
  worker.on('error', (err) => console.error('[worker] error', err));

  const assessWorker = startAssessWorker(client);
  assessWorker.on('error', (err) => console.error('[assess] worker error', err));

  const shutdown = async (): Promise<void> => {
    signal.stopped = true;
    await Promise.all([worker.close(), assessWorker.close()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (env.commitRegistryAddress && env.gasWalletPrivateKey) {
    console.log('[commit] loop enabled →', env.commitRegistryAddress);
    void runCommitLoop(signal);
  } else {
    console.log('[commit] loop disabled (COMMIT_REGISTRY_ADDRESS / GAS_WALLET_PRIVATE_KEY not set)');
  }

  void runOutcomesLoop(client, signal);
  // BENCHMARK_FILE, if set, must be an absolute path (or shared-relative-to-cwd
  // path both processes agree on) — leave it unset and runScorerLoop anchors to
  // the repo root, which is what the API's default also anchors to.
  void runScorerLoop(signal, { outFile: process.env.BENCHMARK_FILE || undefined });

  if (env.agentPrivateKey && process.env.TOKEN_ENCRYPTION_KEY) {
    console.log('[metabolism] lifecycle loop enabled');
    void runLifecycleLoop(signal);
  } else {
    console.log(
      '[metabolism] lifecycle loop disabled (AGENT_EIP712_PRIVATE_KEY / TOKEN_ENCRYPTION_KEY not set)',
    );
  }

  if (env.openrouterModelDeepdive && env.agentPrivateKey) {
    console.log(`[deepdive] enabled — model ${env.openrouterModelDeepdive}`);
    const ddWorker = startDeepdiveWorker();
    ddWorker.on('error', (err) => console.error('[deepdive] worker error', err));
    void runDeepdiveLoop(signal);
  } else {
    console.log('[deepdive] disabled (OPENROUTER_MODEL_DEEPDIVE / AGENT_EIP712_PRIVATE_KEY not set)');
  }

  if (env.telegramBotToken && env.telegramChatId) {
    console.log('[telegram] free-feed poster enabled ->', env.telegramChatId);
    void runTelegramPosterLoop(signal, {
      botToken: env.telegramBotToken,
      chatId: env.telegramChatId,
      chainId: env.chainId,
      intervalMs: env.telegramPosterIntervalMs,
    });
  } else {
    console.log('[telegram] free-feed poster disabled (TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID not set)');
  }

  console.log('[watcher] starting pool-creation poller for chain', client.chain?.id ?? '(env)');
  await runPoller(client, signal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
