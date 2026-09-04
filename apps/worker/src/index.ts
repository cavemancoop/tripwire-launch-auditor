import { runPoller, type StopSignal } from './watcher/poller';
import { rpc } from './watcher/rpc';
import { startFeaturesWorker } from './watcher/t10';

async function main(): Promise<void> {
  const client = rpc();
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

  console.log('[watcher] starting pool-creation poller for chain', client.chain?.id ?? '(env)');
  await runPoller(client, signal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
