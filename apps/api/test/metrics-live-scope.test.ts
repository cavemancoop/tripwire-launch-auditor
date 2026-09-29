import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ reportFindFirst: vi.fn(), launchCount: vi.fn(), outcomeGroupBy: vi.fn() }));
vi.mock('@launch-auditor/db', () => ({
  prisma: {
    watcherCursor: { findFirst: async () => null },
    commit: { findFirst: async () => null },
    lifecycleLog: { findFirst: async () => null },
    metabolismEpoch: { findFirst: async () => null },
    launch: { count: db.launchCount },
    report: { count: async () => 0, findFirst: db.reportFindFirst },
    outcome: { groupBy: db.outcomeGroupBy },
    catchSiteFailure: { findMany: async () => [] },
  },
}));

import { prismaMetricsReader } from '../src/metrics';

describe('live deterministic report metrics', () => {
  it('excludes retrospective launches from the latest report and cohort coverage', async () => {
    db.reportFindFirst.mockResolvedValue(null);
    db.launchCount.mockResolvedValue(0);
    db.outcomeGroupBy.mockResolvedValue([]);
    await prismaMetricsReader();
    expect(db.reportFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        forecaster: 'det_v0',
        trigger: 'launch',
        launch: { is: { retrospective: false } },
      },
    }));
    const coverageQueries = db.launchCount.mock.calls.map(([query]) => query).filter((query) => query.where.launchAt);
    expect(coverageQueries).toHaveLength(2);
    for (const query of coverageQueries) {
      expect(query.where.retrospective).toBe(false);
    }
    expect(coverageQueries[1]?.where?.reports?.some).toEqual({
      forecaster: 'det_v0', trigger: 'launch',
    });
  });

  it('reads excluded rows by status without adding them to pending or resolved counts', async () => {
    db.reportFindFirst.mockResolvedValue(null);
    db.launchCount.mockResolvedValue(0);
    db.outcomeGroupBy.mockImplementation(async ({ where }: { where: { status: string } }) => {
      const counts: Record<string, number> = { PENDING: 9, RESOLVED: 2, POLICY_EXCLUDED: 40 };
      return [{ label: 'INSIDER_EXIT', _count: { _all: counts[where.status] } }];
    });
    const snapshot = await prismaMetricsReader();
    expect(snapshot.outcomes).toEqual([{
      label: 'INSIDER_EXIT', pendingDue: 9, deferred: 9, resolved24h: 2, policyExcluded: 40,
    }]);
    expect(db.outcomeGroupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'POLICY_EXCLUDED' } }));
  });
});
