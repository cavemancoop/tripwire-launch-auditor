import { Prisma, prisma } from '@launch-auditor/db';
import { POLICY_VERSION, REASON_CODE } from './policy-correction-plan';

interface BatchRow { selected: bigint; changed: bigint; skipped: bigint }

export interface BatchResult { selected: number; changed: number; skipped: number }

function validBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error('batchSize must be 1..1000');
  }
}

/**
 * Apply one transaction of at most 1000 frozen candidates. Every selected row
 * becomes either applied or skipped, so interruption and retries are safe.
 * Live status, lane, claim, value and updatedAt must still match the manifest.
 */
export async function applyPolicyCorrectionBatch(runId: string, batchSize: number): Promise<BatchResult> {
  validBatchSize(batchSize);
  const run = await prisma.policyExclusionRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.policyVersion !== POLICY_VERSION || run.reasonCode !== REASON_CODE) throw new Error('run policy version mismatch');
  const rows = await prisma.$transaction((tx) => tx.$queryRaw<BatchRow[]>(Prisma.sql`
    WITH picked AS MATERIALIZED (
      SELECT c."outcomeId"
      FROM "policy_exclusion_candidates" c
      WHERE c."runId" = ${runId} AND c."appliedAt" IS NULL AND c."skippedAt" IS NULL
      ORDER BY c."outcomeId" LIMIT ${batchSize}
      FOR UPDATE OF c SKIP LOCKED
    ), changed AS (
      UPDATE "outcomes" o SET
        status = 'POLICY_EXCLUDED',
        evidence = COALESCE(o.evidence, '{}'::jsonb) || jsonb_build_object(
          'policyRunId', ${runId}::text,
          'policyVersion', ${POLICY_VERSION}::text,
          'reasonCode', ${REASON_CODE}::text,
          'excludedAt', now()::text
        ),
        "updatedAt" = now()
      FROM picked p, "policy_exclusion_candidates" c, "launches" l, "features" f
      WHERE o.id = p."outcomeId" AND c."runId" = ${runId}
        AND c."outcomeId" = p."outcomeId" AND l.id = o."launchId"
        AND f."launchId" = l.id AND f."t10ComputedAt" IS NOT NULL
        AND o.status = 'PENDING' AND o.value IS NULL
        AND o."claimToken" IS NULL AND o."updatedAt" = c."originalUpdatedAt"
        AND l.lane::text = 'index'
      RETURNING o.id
    ), marked AS (
      UPDATE "policy_exclusion_candidates" c SET
        "appliedAt" = CASE WHEN changed.id IS NOT NULL THEN now() ELSE NULL END,
        "skippedAt" = CASE WHEN changed.id IS NULL THEN now() ELSE NULL END,
        "skipReason" = CASE WHEN changed.id IS NULL THEN 'changed_since_prepare_or_claimed' ELSE NULL END
      FROM picked p LEFT JOIN changed ON changed.id = p."outcomeId"
      WHERE c."runId" = ${runId} AND c."outcomeId" = p."outcomeId"
      RETURNING c."appliedAt", c."skippedAt"
    )
    SELECT COUNT(*)::bigint AS selected,
      COUNT(*) FILTER (WHERE "appliedAt" IS NOT NULL)::bigint AS changed,
      COUNT(*) FILTER (WHERE "skippedAt" IS NOT NULL)::bigint AS skipped
    FROM marked
  `), { maxWait: 10_000, timeout: 30_000 });
  const row = rows[0]!;
  return { selected: Number(row.selected), changed: Number(row.changed), skipped: Number(row.skipped) };
}

/** Restore only rows still exactly in this run's excluded state. */
export async function revertPolicyCorrectionBatch(runId: string, batchSize: number): Promise<BatchResult> {
  validBatchSize(batchSize);
  await prisma.policyExclusionRun.findUniqueOrThrow({ where: { id: runId } });
  const rows = await prisma.$transaction((tx) => tx.$queryRaw<BatchRow[]>(Prisma.sql`
    WITH picked AS MATERIALIZED (
      SELECT c."outcomeId"
      FROM "policy_exclusion_candidates" c
      WHERE c."runId" = ${runId} AND c."appliedAt" IS NOT NULL
        AND c."revertedAt" IS NULL AND c."revertSkippedAt" IS NULL
      ORDER BY c."outcomeId" LIMIT ${batchSize}
      FOR UPDATE OF c SKIP LOCKED
    ), changed AS (
      UPDATE "outcomes" o SET
        status = 'PENDING', value = c."originalValue",
        evidence = c."originalEvidence", "measuredAt" = c."originalMeasuredAt",
        "updatedAt" = c."originalUpdatedAt"
      FROM picked p, "policy_exclusion_candidates" c
      WHERE o.id = p."outcomeId" AND c."runId" = ${runId}
        AND c."outcomeId" = p."outcomeId"
        AND o.status = 'POLICY_EXCLUDED' AND o."updatedAt" = c."appliedAt"
        AND o.evidence->>'policyRunId' = ${runId}
      RETURNING o.id
    ), marked AS (
      UPDATE "policy_exclusion_candidates" c SET
        "revertedAt" = CASE WHEN changed.id IS NOT NULL THEN now() ELSE NULL END,
        "revertSkippedAt" = CASE WHEN changed.id IS NULL THEN now() ELSE NULL END,
        "revertSkipReason" = CASE WHEN changed.id IS NULL THEN 'excluded_row_changed_or_missing' ELSE NULL END
      FROM picked p LEFT JOIN changed ON changed.id = p."outcomeId"
      WHERE c."runId" = ${runId} AND c."outcomeId" = p."outcomeId"
      RETURNING c."revertedAt", c."revertSkippedAt"
    )
    SELECT COUNT(*)::bigint AS selected,
      COUNT(*) FILTER (WHERE "revertedAt" IS NOT NULL)::bigint AS changed,
      COUNT(*) FILTER (WHERE "revertSkippedAt" IS NOT NULL)::bigint AS skipped
    FROM marked
  `), { maxWait: 10_000, timeout: 30_000 });
  const row = rows[0]!;
  return { selected: Number(row.selected), changed: Number(row.changed), skipped: Number(row.skipped) };
}

interface SummaryRow {
  total: bigint;
  pending: bigint;
  applied: bigint;
  skipped: bigint;
  reverted: bigint;
  revertConflicts: bigint;
}

export async function policyCorrectionSummary(runId: string): Promise<Record<keyof SummaryRow, number>> {
  const rows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "appliedAt" IS NULL AND "skippedAt" IS NULL)::bigint AS pending,
      COUNT(*) FILTER (WHERE "appliedAt" IS NOT NULL AND "revertedAt" IS NULL)::bigint AS applied,
      COUNT(*) FILTER (WHERE "skippedAt" IS NOT NULL)::bigint AS skipped,
      COUNT(*) FILTER (WHERE "revertedAt" IS NOT NULL)::bigint AS reverted,
      COUNT(*) FILTER (WHERE "revertSkippedAt" IS NOT NULL)::bigint AS "revertConflicts"
    FROM "policy_exclusion_candidates" WHERE "runId" = ${runId}
  `);
  const row = rows[0]!;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as Record<keyof SummaryRow, number>;
}
