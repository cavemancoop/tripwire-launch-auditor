import { Worker } from 'bullmq';
import { QUEUE_NAMES, parseRedisUrl } from './queues';

const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

function main(): void {
  const worker = new Worker(
    QUEUE_NAMES.watcher,
    async (job) => {
      // Real handlers land in M1+. For now, acknowledge and move on.
      // eslint-disable-next-line no-console
      console.log(`[worker] ${job.queueName}:${job.name} #${job.id}`);
    },
    { connection },
  );

  worker.on('ready', () => {
    // eslint-disable-next-line no-console
    console.log('[worker] ready');
  });
  worker.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[worker] error', err);
  });
}

main();
