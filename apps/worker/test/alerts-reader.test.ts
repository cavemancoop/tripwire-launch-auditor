import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  report: vi.fn(),
}));
vi.mock('@launch-auditor/db', () => ({
  prisma: {
    lifecycleLog: { findFirst: async () => null },
    metabolismEpoch: { findFirst: async () => null },
    commit: { findFirst: async () => null },
    watcherCursor: { findFirst: async () => null },
    report: { findFirst: db.report },
  },
}));

import { evaluateAlerts } from '../src/alerts';

describe('live report alert reader', () => {
  it('excludes retrospective launches even when their report flag was left false by the backfill writer', async () => {
    db.report.mockResolvedValue(null);
    await evaluateAlerts();
    expect(db.report).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        forecaster: 'det_v0',
        trigger: 'launch',
        launch: { is: { retrospective: false } },
      },
    }));
  });
});
