import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

if (!process.env.TEST_REDIS_URL) {
  console.error('Set TEST_REDIS_URL to a disposable localhost Redis database 15 before running test:redis.');
  process.exit(2);
}
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitest = resolve(appDir, 'node_modules/vitest/vitest.mjs');
const run = spawnSync(process.execPath, [vitest, 'run', 'test/assess-redis.integration.test.ts'], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);
