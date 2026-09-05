import { runCommitLoop } from './commit';
import { loadEnv } from './env';
import { runPoller, type StopSignal } from './watcher/poller';
import { rpc } from './watcher/rpc';
import { startFeaturesWorker } from './watcher/t10';

async function main(): Promise<void> {
  const client = rpc();
  const env = loadEnv();
  const signal: StopSignal = { stopped: false };

  const worker = startFeaturesWorker(client);
  worker.on('ready', () => console.log('[worker] features queue ready'));
  worker.on('error', (err) => console.error('[worker] error', err));

  const shutdown = async (): Promise<void> => {
    signal.stopped = true;
    await worker.close();
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

  console.log('[watcher] starting pool-creation poller for chain', client.chain?.id ?? '(env)');
  await runPoller(client, signal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
