/**
 * `pnpm orbio:push-key` — copy the gateway key from the local encrypted token
 * store into a deployed Railway service as `ORBIO_API_KEY`.
 *
 * Why this exists: `pnpm orbio:auth` writes its result to a local file
 * (`.orbio/token-store.enc.json`, gitignored). A deployed container has its own
 * empty filesystem and has never run that interactive flow, so it has no key at
 * all — every deep-dive throws at the key resolver and is counted as a silent
 * skip.
 *
 * Measured 2026-09-14: a gateway key keeps billing inference normally with an
 * OAuth session that expired two days earlier. The session bounds *key
 * management* (create / revoke / read balance through the MCP), not spending.
 * So pushing the key once is enough for the deployed worker to run deep-dives
 * continuously — no callback port to expose, no volume to mount, no daily
 * re-auth for inference.
 *
 * The key is never printed and never passed through the shell's history: it
 * goes straight from the decrypted store into the `railway` CLI's argv.
 *
 * Usage:
 *   pnpm orbio:push-key                 # pushes to the `worker` service
 *   pnpm orbio:push-key --service api   # or another service
 *   pnpm orbio:push-key --dry-run       # show what would happen, change nothing
 */
import { spawnSync } from 'node:child_process';
import { resolveGatewayKey } from '../deepdive/openrouter';
import { loadEnv } from '../env';

// The store is decrypted with TOKEN_ENCRYPTION_KEY, which lives in .env —
// resolveGatewayKey reads process.env, so the file has to be loaded first.
loadEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const service = arg('service') ?? 'worker';
const dryRun = process.argv.includes('--dry-run');

const key = resolveGatewayKey();
if (!key) {
  console.error(
    'No gateway key found locally.\n' +
      'The key lives in the encrypted token store and is minted by the metabolism\n' +
      'lifecycle runner. Run `pnpm orbio:auth` first, let the runner claim a key,\n' +
      'then re-run this.',
  );
  process.exit(1);
}

// Show enough to confirm it's the right key, never enough to leak it.
console.log(`gateway key: ${key.slice(0, 10)}…${key.slice(-4)} (${key.length} chars)`);
console.log(`target service: ${service}`);

if (dryRun) {
  console.log('\n--dry-run: nothing was changed.');
  process.exit(0);
}

const res = spawnSync(
  'railway',
  ['variables', '--service', service, '--set', `ORBIO_API_KEY=${key}`],
  { stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' },
);

if (res.status !== 0) {
  console.error(
    `\nrailway exited ${res.status}. Is the CLI installed and linked?\n` +
      '  railway login && railway link',
  );
  process.exit(res.status ?? 1);
}

console.log(
  '\nPushed. Railway will redeploy the service with the key in place.\n' +
    'Watch it take effect:  railway logs --service ' + service + ' | grep deepdive',
);
