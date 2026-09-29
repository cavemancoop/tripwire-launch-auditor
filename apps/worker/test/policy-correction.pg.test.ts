import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Prisma, PrismaClient, prisma } from '@launch-auditor/db';
import { applyPolicyCorrectionBatch, policyCorrectionSummary, revertPolicyCorrectionBatch } from '../src/outcomes/policy-correction-batches';
import { preparePolicyCorrection, previewPolicyCorrection } from '../src/outcomes/policy-correction-plan';

// Explicit local-only integration gate. `pnpm verify` remains offline and
// never reads DATABASE_URL or spawns Docker for this test.
const local = process.env.M2_REHEARSAL === '1'
  && /^postgresql:\/\/postgres@127\.0\.0\.1:55433\/m2_integration$/.test(process.env.DATABASE_URL ?? '')
  && Boolean(process.env.DOCKER_EXE);

describe.skipIf(!local)('M2 correction on disposable PostgreSQL 16', () => {
  it('freezes, backs up, batches, resumes and compensates without touching other rows', async () => {
    const runId = randomUUID();
    const token = `0x${randomBytes(20).toString('hex')}`;
    const otherToken = `0x${randomBytes(20).toString('hex')}`;
    const promotingToken = `0x${randomBytes(20).toString('hex')}`;
    const unclassifiedToken = `0x${randomBytes(20).toString('hex')}`;
    const indexId = `m2-test-index-${runId}`;
    const qualifiedId = `m2-test-qualified-${runId}`;
    const promotingId = `m2-test-promoting-${runId}`;
    const unclassifiedId = `m2-test-unclassified-${runId}`;
    const anchor = new Date('2026-09-18T00:00:00Z');
    const oldMeasuredAt = new Date('2026-09-20T00:00:00Z');
    const ids = Object.fromEntries(['evidence', 'sell', 'claimed', 'changed', 'conflict', 'trading', 'resolved', 'qualified', 'late', 'promoting', 'unclassified']
      .map((kind) => [kind, `m2-test-${kind}-${runId}`]));
    const docker = (...args: string[]): string =>
      execFileSync(process.env.DOCKER_EXE!, ['exec', 'tripwire-m2-rehearsal', ...args], { stdio: 'pipe' }).toString();
    const outcome = (kind: string, label: 'INSIDER_EXIT' | 'SELL_IMPAIRED' | 'LIQ_IMPAIRED' | 'TRADING_ALIVE', horizon: string,
      options: Record<string, unknown> = {}) => ({
      id: ids[kind]!, chainId: 4663, tokenAddress: kind === 'qualified' ? otherToken
        : kind === 'promoting' ? promotingToken : kind === 'unclassified' ? unclassifiedToken : token,
      anchorTime: anchor, trigger: 'launch' as const,
      launchId: kind === 'qualified' ? qualifiedId
        : kind === 'promoting' ? promotingId : kind === 'unclassified' ? unclassifiedId : indexId,
      label, horizon, ...options,
    });
    let restored: PrismaClient | undefined;
    try {
      await prisma.launch.createMany({ data: [
        { id: indexId, chainId: 4663, tokenAddress: token, creatorAddress: token, launchBlock: 1n,
          launchTxHash: `0x${'1'.repeat(64)}`, lane: 'index' },
        { id: qualifiedId, chainId: 4663, tokenAddress: otherToken, creatorAddress: otherToken, launchBlock: 2n,
          launchTxHash: `0x${'2'.repeat(64)}`, lane: 'qualified' },
        { id: promotingId, chainId: 4663, tokenAddress: promotingToken, creatorAddress: promotingToken, launchBlock: 3n,
          launchTxHash: `0x${'3'.repeat(64)}`, lane: 'index' },
        { id: unclassifiedId, chainId: 4663, tokenAddress: unclassifiedToken, creatorAddress: unclassifiedToken, launchBlock: 4n,
          launchTxHash: `0x${'4'.repeat(64)}`, lane: 'index' },
      ] });
      await prisma.feature.createMany({ data: [
        { launchId: indexId, t10ComputedAt: new Date() },
        { launchId: promotingId, t10ComputedAt: new Date() },
        { launchId: unclassifiedId },
      ] });
      await prisma.outcome.createMany({ data: [
        outcome('evidence', 'INSIDER_EXIT', '24h', { evidence: { old: 'keep' }, measuredAt: oldMeasuredAt }),
        outcome('sell', 'SELL_IMPAIRED', '1h'),
        outcome('claimed', 'LIQ_IMPAIRED', '7d', { claimToken: 'active', claimExpiresAt: new Date('2026-10-01T00:00:00Z') }),
        outcome('changed', 'SELL_IMPAIRED', '24h'),
        outcome('conflict', 'LIQ_IMPAIRED', '24h'),
        outcome('trading', 'TRADING_ALIVE', '24h'),
        outcome('resolved', 'INSIDER_EXIT', '6h', { status: 'RESOLVED', value: false }),
        outcome('qualified', 'INSIDER_EXIT', '72h'),
        outcome('promoting', 'INSIDER_EXIT', '24h'),
        outcome('unclassified', 'INSIDER_EXIT', '24h'),
      ] });
      const cutoffAt = new Date();
      await prisma.outcome.create({ data: outcome('late', 'INSIDER_EXIT', '1h', {
        createdAt: new Date(cutoffAt.getTime() + 1_000),
      }) });
      const preview = await previewPolicyCorrection(cutoffAt);
      expect(preview.total).toBe(6);
      expect(preview.byLabel.reduce((n, row) => n + row.claimed, 0)).toBe(1);
      await prisma.outcome.update({ where: { id: ids.sell }, data: { evidence: ['nonobject'] } });
      await expect(preparePolicyCorrection({ runId, cutoffAt, expectedCandidates: 6,
        backupSha256: 'a'.repeat(64) })).rejects.toThrow('evidence values are not JSON objects');
      expect(await prisma.policyExclusionRun.count({ where: { id: runId } })).toBe(0);
      await prisma.outcome.update({ where: { id: ids.sell }, data: { evidence: Prisma.DbNull } });
      // Capture the actual pre-correction backup before preparing the ledger.
      docker('pg_dump', '-U', 'postgres', '-Fc', '-f', '/tmp/tripwire-m2-rehearsal.dump', 'm2_integration');
      const backupSha256 = docker('sha256sum', '/tmp/tripwire-m2-rehearsal.dump').split(' ')[0]!;
      await expect(preparePolicyCorrection({ runId, cutoffAt, expectedCandidates: 5,
        backupSha256 })).rejects.toThrow('candidate count changed');
      expect(await prisma.policyExclusionRun.count({ where: { id: runId } })).toBe(0);
      expect(await preparePolicyCorrection({ runId, cutoffAt, expectedCandidates: 6,
        backupSha256 })).toBe(6);

      // Changes after the manifest or a live claim cannot be silently lost.
      await prisma.outcome.update({ where: { id: ids.changed }, data: { evidence: { later: true } } });
      await prisma.launch.update({ where: { id: promotingId }, data: { lane: 'qualified' } });
      let applied = 0;
      let skipped = 0;
      for (let n = 0; n < 4; n++) {
        const batch = await applyPolicyCorrectionBatch(runId, 2);
        applied += batch.changed;
        skipped += batch.skipped;
        if (!batch.selected) break;
      }
      expect({ applied, skipped }).toEqual({ applied: 3, skipped: 3 });
      expect(await applyPolicyCorrectionBatch(runId, 2)).toEqual({ selected: 0, changed: 0, skipped: 0 });
      const excluded = await prisma.outcome.findUniqueOrThrow({ where: { id: ids.evidence } });
      expect(excluded.status).toBe('POLICY_EXCLUDED');
      expect(excluded.evidence).toMatchObject({ old: 'keep', policyRunId: runId, reasonCode: 'nonqualified_lane' });
      expect(excluded.measuredAt).toEqual(oldMeasuredAt);
      expect((await prisma.outcome.findUniqueOrThrow({ where: { id: ids.claimed } })).status).toBe('PENDING');
      expect((await prisma.outcome.findUniqueOrThrow({ where: { id: ids.qualified } })).status).toBe('PENDING');
      expect((await prisma.outcome.findUniqueOrThrow({ where: { id: ids.late } })).status).toBe('PENDING');
      expect((await prisma.outcome.findUniqueOrThrow({ where: { id: ids.unclassified } })).status).toBe('PENDING');
      expect((await prisma.outcome.findUniqueOrThrow({ where: { id: ids.promoting } })).status).toBe('PENDING');

      // A real restore in a second local DB recovers the pre-write outcome
      // and contains no ledger run because the dump predates preparation.
      docker('dropdb', '-U', 'postgres', '--if-exists', 'm2_restore');
      docker('createdb', '-U', 'postgres', 'm2_restore');
      docker('pg_restore', '-U', 'postgres', '-d', 'm2_restore', '/tmp/tripwire-m2-rehearsal.dump');
      restored = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres@127.0.0.1:55433/m2_restore' } } });
      expect(await restored.policyExclusionCandidate.count({ where: { runId } })).toBe(0);
      const backupRow = await restored.outcome.findUniqueOrThrow({ where: { id: ids.evidence } });
      expect(backupRow.status).toBe('PENDING');
      expect(backupRow.evidence).toEqual({ old: 'keep' });

      await prisma.outcome.update({ where: { id: ids.conflict }, data: { evidence: { policyRunId: runId, later: true } } });
      let reverted = 0;
      let conflicts = 0;
      for (let n = 0; n < 3; n++) {
        const batch = await revertPolicyCorrectionBatch(runId, 2);
        reverted += batch.changed;
        conflicts += batch.skipped;
        if (!batch.selected) break;
      }
      expect({ reverted, conflicts }).toEqual({ reverted: 2, conflicts: 1 });
      const restoredOriginal = await prisma.outcome.findUniqueOrThrow({ where: { id: ids.evidence } });
      expect(restoredOriginal.status).toBe('PENDING');
      expect(restoredOriginal.evidence).toEqual({ old: 'keep' });
      expect(restoredOriginal.measuredAt).toEqual(oldMeasuredAt);
      expect((await prisma.outcome.findUniqueOrThrow({ where: { id: ids.conflict } })).status).toBe('POLICY_EXCLUDED');
      expect(await policyCorrectionSummary(runId)).toEqual({
        total: 6, pending: 0, applied: 1, skipped: 3, reverted: 2, revertConflicts: 1,
      });
    } finally {
      await restored?.$disconnect();
      await prisma.policyExclusionCandidate.deleteMany({ where: { runId } });
      await prisma.policyExclusionRun.deleteMany({ where: { id: runId } });
      await prisma.outcome.deleteMany({ where: { id: { in: Object.values(ids) } } });
      await prisma.launch.deleteMany({ where: { id: { in: [indexId, qualifiedId, promotingId, unclassifiedId] } } });
    }
  }, 120_000);
});
