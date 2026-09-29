import { Prisma, prisma, type $Enums } from '@launch-auditor/db';

export type ScoreScope = 'live' | 'retrospective' | 'both';

export interface ScoreReport {
  chainId: number;
  tokenAddress: string;
  reportTime: Date;
  trigger: $Enums.ReportTrigger;
  forecaster: $Enums.ForecasterKind;
  launchId: string | null;
  commitId: string | null;
  launch: { source: string } | null;
  commit: { blockNumber: bigint | null } | null;
  pInsiderExit6h: number | null;
  pInsiderExit24h: number | null;
  pInsiderExit72h: number | null;
  pSellImpaired1h: number | null;
  pSellImpaired24h: number | null;
  pLiqImpaired24h: number | null;
  pLiqImpaired7d: number | null;
  pDrawdown80_24h: number | null;
  pDrawdown80_7d: number | null;
  pTradingAlive24h: number | null;
  pTradingAlive7d: number | null;
}

type RawScoreReport = Omit<ScoreReport, 'launch' | 'commit'> & {
  launchSource: string | null;
  commitBlockNumber: bigint | null;
};

/**
 * Restrict reports in Postgres to exact resolved observation keys before
 * loading their launch/commit relations. The old Prisma findMany fetched every
 * validated report (337k on 2026-09-29), then discarded most of them in JS;
 * its relation IN-list could stall a snapshot for many minutes. A distinct
 * key CTE keeps one report per report row even when several outcomes resolve
 * for the same anchor. Address comparison matches collect.ts's lowercased key.
 */
export async function readReportsForResolved(scope: ScoreScope): Promise<ScoreReport[]> {
  const scopeFilter = scope === 'both' ? Prisma.empty : Prisma.sql`AND o.retrospective = ${scope === 'retrospective'}`;
  const raw = await prisma.$queryRaw<RawScoreReport[]>(Prisma.sql`
    WITH resolved_keys AS (
      SELECT DISTINCT o."chainId", lower(o."tokenAddress") AS token, o."anchorTime"
      FROM "outcomes" o
      WHERE o.status = 'RESOLVED' AND o.value IS NOT NULL ${scopeFilter}
    )
    SELECT
      r."chainId", r."tokenAddress", r."reportTime", r.trigger,
      r.forecaster, r."launchId", r."commitId",
      r."pInsiderExit6h", r."pInsiderExit24h", r."pInsiderExit72h",
      r."pSellImpaired1h", r."pSellImpaired24h",
      r."pLiqImpaired24h", r."pLiqImpaired7d",
      r."pDrawdown80_24h", r."pDrawdown80_7d",
      r."pTradingAlive24h", r."pTradingAlive7d",
      l.source AS "launchSource", c."blockNumber" AS "commitBlockNumber"
    FROM resolved_keys k
    JOIN "reports" r ON r."chainId" = k."chainId"
      AND lower(r."tokenAddress") = k.token
      AND r."reportTime" = k."anchorTime"
    LEFT JOIN "launches" l ON l.id = r."launchId"
    LEFT JOIN "commits" c ON c.id = r."commitId"
    WHERE r."validatorPassed" = true
    ORDER BY r."reportTime" ASC, r."createdAt" ASC
  `);
  return raw.map(({ launchSource, commitBlockNumber, ...report }) => ({
    ...report,
    launch: launchSource === null ? null : { source: launchSource },
    commit: report.commitId === null ? null : { blockNumber: commitBlockNumber },
  }));
}

const LAUNCH_BATCH = 500;
const sourceCache = new Map<string, string>();

/** Batch baseline source lookups; never issue one query per observation. */
export async function warmLaunchSources(ids: Iterable<string | null>): Promise<void> {
  const missing = [...new Set([...ids].filter((id): id is string => id !== null && !sourceCache.has(id)))];
  for (let i = 0; i < missing.length; i += LAUNCH_BATCH) {
    const chunk = missing.slice(i, i + LAUNCH_BATCH);
    const launches = await prisma.launch.findMany({ where: { id: { in: chunk } }, select: { id: true, source: true } });
    for (const id of chunk) sourceCache.set(id, 'unknown');
    for (const launch of launches) sourceCache.set(launch.id, launch.source);
  }
}

export function launchSource(launchId: string | null): string {
  return launchId === null ? 'unknown' : sourceCache.get(launchId) ?? 'unknown';
}
