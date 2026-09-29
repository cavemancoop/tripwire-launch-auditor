import { prisma } from '@launch-auditor/db';
import { applyPolicyCorrectionBatch, policyCorrectionSummary, revertPolicyCorrectionBatch } from '../outcomes/policy-correction-batches';
import { preparePolicyCorrection, previewPolicyCorrection } from '../outcomes/policy-correction-plan';

// Read-only by default. Mutating subcommands require explicit arguments and
// remain separate from the normal worker loops and deploy entrypoint.
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const action = args[0] ?? 'preview';
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const required = (name: string): string => {
  const value = option(name);
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required`);
  return value;
};
const flag = (name: string): boolean => args.includes(`--${name}`);
const integer = (name: string, fallback?: number): number => {
  const raw = option(name);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (!raw || !/^\d+$/.test(raw)) throw new Error(`--${name} must be a nonnegative integer`);
  return Number(raw);
};
const cutoff = (): Date => {
  const raw = action === 'preview' && !option('cutoff') ? new Date().toISOString() : required('cutoff');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(raw)) {
    throw new Error('--cutoff must be an explicit UTC ISO timestamp ending in Z');
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('invalid cutoff timestamp');
  return date;
};
const authorized = (): void => {
  if (!flag('authorize')) throw new Error('write command requires --authorize');
};

async function main(): Promise<void> {
  if (action === 'preview') {
    console.log(JSON.stringify(await previewPolicyCorrection(cutoff()), null, 2));
    return;
  }
  if (action === 'summary') {
    console.log(JSON.stringify(await policyCorrectionSummary(required('run-id')), null, 2));
    return;
  }
  if (action === 'prepare') {
    authorized();
    const runId = required('run-id');
    const prepared = await preparePolicyCorrection({
      runId, cutoffAt: cutoff(), expectedCandidates: integer('expected-candidates'),
      backupSha256: required('backup-sha256'),
    });
    console.log(JSON.stringify({ runId, prepared, outcomesChanged: 0 }));
    return;
  }
  if (action !== 'apply' && action !== 'revert') throw new Error(`unknown action: ${action}`);
  authorized();
  const runId = required('run-id');
  if (action === 'apply') {
    if (!flag('qualified-only-confirmed')) throw new Error('apply requires --qualified-only-confirmed');
    const run = await prisma.policyExclusionRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.candidateCount !== integer('expected-candidates')) throw new Error('candidate count attestation mismatch');
    if (run.backupSha256 !== required('backup-sha256')) throw new Error('backup digest attestation mismatch');
  }
  const batchSize = integer('batch-size', 500);
  const batches = integer('batches', 1);
  if (batches < 1 || batches > 100) throw new Error('--batches must be 1..100');
  let changed = 0;
  let skipped = 0;
  for (let i = 0; i < batches; i++) {
    const result = action === 'apply'
      ? await applyPolicyCorrectionBatch(runId, batchSize)
      : await revertPolicyCorrectionBatch(runId, batchSize);
    changed += result.changed;
    skipped += result.skipped;
    if (result.selected === 0) break;
  }
  console.log(JSON.stringify({ action, runId, changed, skipped, summary: await policyCorrectionSummary(runId) }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
