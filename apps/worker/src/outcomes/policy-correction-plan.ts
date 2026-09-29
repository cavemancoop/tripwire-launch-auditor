import { Prisma, prisma } from '@launch-auditor/db';

export const POLICY_VERSION = 'm2-known-index-v1';
export const REASON_CODE = 'nonqualified_lane';
export const LABELS = ['INSIDER_EXIT', 'SELL_IMPAIRED', 'LIQ_IMPAIRED'] as const;

interface PreviewRow {
  label: string;
  candidates: bigint;
  withEvidence: bigint;
  withValue: bigint;
  claimed: bigint;
  nonObjectEvidence: bigint;
}

export interface CorrectionPreview {
  cutoffAt: string;
  byLabel: Array<{ label: string; candidates: number; withEvidence: number; withValue: number; claimed: number; nonObjectEvidence: number }>;
  total: number;
}

/** Read-only: finalized index-lane PENDING rows, without a horizon filter. */
export async function previewPolicyCorrection(cutoffAt: Date): Promise<CorrectionPreview> {
  const rows = await prisma.$queryRaw<PreviewRow[]>(Prisma.sql`
    SELECT o.label::text AS label, COUNT(*)::bigint AS candidates,
      COUNT(o.evidence)::bigint AS "withEvidence",
      COUNT(*) FILTER (WHERE o.value IS NOT NULL)::bigint AS "withValue",
      COUNT(*) FILTER (WHERE o."claimToken" IS NOT NULL)::bigint AS claimed,
      COUNT(*) FILTER (WHERE o.evidence IS NOT NULL AND jsonb_typeof(o.evidence) <> 'object')::bigint AS "nonObjectEvidence"
    FROM "outcomes" o
    JOIN "launches" l ON l.id = o."launchId"
    JOIN "features" f ON f."launchId" = l.id AND f."t10ComputedAt" IS NOT NULL
    WHERE o.status = 'PENDING'
      AND o.label::text IN ('INSIDER_EXIT', 'SELL_IMPAIRED', 'LIQ_IMPAIRED')
      AND l.lane::text = 'index'
      AND o."createdAt" <= ${cutoffAt}
    GROUP BY o.label ORDER BY o.label
  `);
  const byLabel = rows.map((r) => ({
    label: r.label,
    candidates: Number(r.candidates),
    withEvidence: Number(r.withEvidence),
    withValue: Number(r.withValue),
    claimed: Number(r.claimed),
    nonObjectEvidence: Number(r.nonObjectEvidence),
  }));
  return { cutoffAt: cutoffAt.toISOString(), byLabel, total: byLabel.reduce((n, r) => n + r.candidates, 0) };
}

export interface PrepareCorrectionInput {
  runId: string;
  cutoffAt: Date;
  expectedCandidates: number;
  backupSha256: string;
}

/**
 * Freeze candidate IDs and original fields in one repeatable-read transaction.
 * This writes only the ledger, not outcomes. A count mismatch or anomalous
 * PENDING value rolls back the entire run. Production use requires an external
 * backup/restore rehearsal and an explicit historical-data decision.
 */
export async function preparePolicyCorrection(input: PrepareCorrectionInput): Promise<number> {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.runId)) throw new Error('runId must be a lowercase UUID');
  if (!/^[a-f0-9]{64}$/.test(input.backupSha256)) throw new Error('backupSha256 must be a lowercase SHA-256 hex digest');
  if (!Number.isSafeInteger(input.expectedCandidates) || input.expectedCandidates < 0) throw new Error('invalid expectedCandidates');
  if (!Number.isFinite(input.cutoffAt.getTime())) throw new Error('invalid cutoffAt');
  if (input.cutoffAt.getTime() > Date.now()) throw new Error('cutoffAt is in the future');

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
    await tx.policyExclusionRun.create({ data: {
      id: input.runId,
      cutoffAt: input.cutoffAt,
      policyVersion: POLICY_VERSION,
      reasonCode: REASON_CODE,
      backupSha256: input.backupSha256,
      candidateCount: input.expectedCandidates,
    } });
    const inserted = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "policy_exclusion_candidates" (
        "runId", "outcomeId", label, "originalValue", "originalEvidence",
        "originalMeasuredAt", "originalUpdatedAt"
      )
      SELECT ${input.runId}, o.id, o.label, o.value, o.evidence,
        o."measuredAt", o."updatedAt"
      FROM "outcomes" o JOIN "launches" l ON l.id = o."launchId"
      JOIN "features" f ON f."launchId" = l.id AND f."t10ComputedAt" IS NOT NULL
      WHERE o.status = 'PENDING'
        AND o.label::text IN ('INSIDER_EXIT', 'SELL_IMPAIRED', 'LIQ_IMPAIRED')
        AND l.lane::text = 'index'
        AND o."createdAt" <= ${input.cutoffAt}
    `);
    if (inserted !== input.expectedCandidates) {
      throw new Error(`candidate count changed: expected ${input.expectedCandidates}, found ${inserted}; run rolled back`);
    }
    const anomalies = await tx.policyExclusionCandidate.count({
      where: { runId: input.runId, originalValue: { not: null } },
    });
    if (anomalies > 0) throw new Error(`${anomalies} PENDING rows contain values; run rolled back`);
    const nonObjects = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n FROM "policy_exclusion_candidates"
      WHERE "runId" = ${input.runId} AND "originalEvidence" IS NOT NULL
        AND jsonb_typeof("originalEvidence") <> 'object'
    `);
    if (nonObjects[0]!.n > 0n) throw new Error(`${nonObjects[0]!.n} evidence values are not JSON objects; run rolled back`);
    return inserted;
  }, { maxWait: 10_000, timeout: 120_000 });
}
