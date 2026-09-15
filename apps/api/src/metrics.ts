/**
 * M9 — Prometheus-format /metrics. Computed fresh per request straight from
 * Postgres, the same read-only pattern as every other /v1/* route (the API
 * never writes, never runs the scorer, never touches Redis).
 */
import { prisma } from '@launch-auditor/db';

export interface MetricsSnapshot {
  watcherStalenessSec: number | null;
  commitAgeSec: number | null;
  metabolismState: string | null;
  idsOrPhantomFlagged: boolean;
  launches24h: number;
  reports24h: number;
}

export type MetricsReader = () => Promise<MetricsSnapshot>;

const age = (now: Date, at: Date | null | undefined): number | null =>
  at ? (now.getTime() - at.getTime()) / 1000 : null;

export const prismaMetricsReader: MetricsReader = async () => {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3_600_000);

  const [watcherCursor, commit, lifecycle, epoch, launches24h, reports24h] = await Promise.all([
    prisma.watcherCursor.findFirst({ orderBy: { updatedAt: 'desc' } }),
    prisma.commit.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.lifecycleLog.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.metabolismEpoch.findFirst({ orderBy: { at: 'desc' } }),
    prisma.launch.count({ where: { createdAt: { gte: since24h } } }),
    prisma.report.count({ where: { createdAt: { gte: since24h } } }),
  ]);

  return {
    watcherStalenessSec: age(now, watcherCursor?.updatedAt),
    commitAgeSec: age(now, commit?.createdAt),
    metabolismState: lifecycle?.newState ?? null,
    idsOrPhantomFlagged: Boolean(lifecycle?.idsMismatch) || Boolean(epoch?.phantom),
    launches24h,
    reports24h,
  };
};

const METABOLISM_STATES = ['NO_KEY', 'ACTIVE', 'DRAINING', 'ROTATING', 'REVOKING', 'STARVED'] as const;

export function formatPrometheus(m: MetricsSnapshot): string {
  const lines: string[] = [];
  const gauge = (name: string, help: string, value: number | null): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${value === null ? 'NaN' : value}`);
  };

  gauge(
    'launch_auditor_watcher_staleness_seconds',
    'Seconds since the watcher last advanced its cursor',
    m.watcherStalenessSec,
  );
  gauge(
    'launch_auditor_commit_age_seconds',
    'Seconds since the last commit batch was formed',
    m.commitAgeSec,
  );
  gauge(
    'launch_auditor_ids_or_phantom_flagged',
    '1 if the latest lifecycle row flags an IDS mismatch or a phantom-spend epoch',
    m.idsOrPhantomFlagged ? 1 : 0,
  );
  gauge('launch_auditor_launches_24h', 'Launches indexed in the trailing 24h', m.launches24h);
  gauge('launch_auditor_reports_24h', 'Reports written in the trailing 24h', m.reports24h);

  lines.push('# HELP launch_auditor_metabolism_state Current metabolism state (1 = active, one series per known state)');
  lines.push('# TYPE launch_auditor_metabolism_state gauge');
  for (const s of METABOLISM_STATES) {
    lines.push(`launch_auditor_metabolism_state{state="${s}"} ${m.metabolismState === s ? 1 : 0}`);
  }

  return lines.join('\n') + '\n';
}
