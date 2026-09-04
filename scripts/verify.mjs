// Single verification entrypoint for every milestone.
// Runs offline: no Docker, no network, no paid APIs.
import { execSync } from 'node:child_process';

// `prisma validate` resolves env("DATABASE_URL") eagerly. Give it a placeholder
// so verify works on a fresh checkout with no .env. Nothing here connects.
process.env.DATABASE_URL ??=
  'postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public';

const SCHEMA = 'packages/db/prisma/schema.prisma';
const steps = [
  ['Prisma client generate', `pnpm exec prisma generate --schema ${SCHEMA}`],
  ['Prisma schema validate', `pnpm exec prisma validate --schema ${SCHEMA}`],
  ['Typecheck (all packages)', 'pnpm -r --workspace-concurrency=1 typecheck'],
  ['Tests (vitest)', 'pnpm -r --workspace-concurrency=1 test'],
];

let failed = null;
for (const [name, cmd] of steps) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    failed = name;
    break;
  }
}

process.stdout.write('\n' + '─'.repeat(60) + '\n');
if (failed) {
  process.stdout.write(`❌ verify failed at: ${failed}\n`);
  process.exit(1);
}
process.stdout.write('✅ verify passed — prisma schema + typecheck + tests all green\n');
