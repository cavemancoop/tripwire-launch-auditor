import { runCommitJob } from '../commit';

// pnpm commit:run [--force]   — run one commit-job pass now.

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const r = await runCommitJob({ force });
  console.log(JSON.stringify(r, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
