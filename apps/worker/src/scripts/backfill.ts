import { logit } from '@launch-auditor/scoring';
import { observedBaseRates, runBackfill } from '../backfill/run';

// pnpm backfill --days N [--max-calls M] [--dry-run] [--resolve-only] [--features-only]
//               [--from-block B] [--to-block B] [--all-heavy]
//   Reconstruct features + outcomes for the last N days of launches
//   (spec §7, retrospective=true). Prints the observed base rates + the
//   det_v0.1 intercept suggestions (checkpoint §8.3) at the end.

function num(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
function big(name: string): bigint | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? BigInt(process.argv[i + 1]!) : undefined;
}

async function main(): Promise<void> {
  const days = num('--days', 14);
  const maxCalls = num('--max-calls', 0);

  const res = await runBackfill({
    days,
    maxCalls,
    dryRun: process.argv.includes('--dry-run'),
    resolveOnly: process.argv.includes('--resolve-only'),
    featuresOnly: process.argv.includes('--features-only'),
    qualifiedOnly: !process.argv.includes('--all-heavy'),
    fromBlock: big('--from-block'),
    toBlock: big('--to-block'),
  });

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const rates = await observedBaseRates();
  console.log('\n── observed base rates (retrospective, RESOLVED) ──');
  if (rates.length === 0) {
    console.log('  (none resolved yet)');
  }
  for (const r of rates) {
    const suggested = logit(r.rate);
    console.log(
      `  ${r.key.padEnd(20)} n=${String(r.n).padStart(4)}  positives=${String(r.positives).padStart(4)}  ` +
        `rate=${r.rate.toFixed(4)}  ->  det_v0.1 biasOverride ${suggested.toFixed(3)}`,
    );
  }
  console.log(
    '\nTo apply: copy the biasOverride values into packages/scoring/weights/det_v0_1.json,\n' +
      'or run again after more launches resolve for a tighter estimate.',
  );
  console.log('\n' + JSON.stringify({ ...res, baseRates: rates }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
