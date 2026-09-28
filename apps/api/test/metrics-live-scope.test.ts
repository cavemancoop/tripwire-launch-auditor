import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ reportFindFirst: vi.fn(), launchCount: vi.fn() }));
vi.mock('@launch-auditor/db', () => ({
  prisma: {
    watcherCursor: { findFirst: async () => null },
    commit: { findFirst: async () => null },
    lifecycleLog: { findFirst: async () => null },
    metabolismEpoch: { findFirst: async () => null },
    launch: { count: db.launchCount },
    report: { count: async () => 0, findFirst: db.reportFindFirst },
    outcome: { groupBy: async () => [] },
    catchSiteFailure: { findMany: async () => [] },
  },
}));

import { prismaMetricsReader } from '../src/metrics';

describe('live deterministic report metrics', () => {
  it('excludes retrospective launches from the latest report and cohort coverage', async () => {
    db.reportFindFirst.mockResolvedValue(null);
    db.launchCount.mockResolvedValue(0);
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
});
