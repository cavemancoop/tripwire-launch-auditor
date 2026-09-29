import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportDraft } from '../src/report/types';

const db = vi.hoisted(() => ({
  launches: new Map<string, { id: string; lane: 'index' | 'qualified'; feature: { t10ComputedAt: Date | null }; lpLockedByConstruction: boolean; retrospective: boolean }>(),
  reports: new Map<string, Record<string, unknown>>(),
  lookups: 0,
}));
vi.mock('@launch-auditor/db', () => ({
  prisma: {
    launch: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        db.lookups++;
        return where.id.in.map((id) => db.launches.get(id)).filter(Boolean);
      },
    },
    report: {
      upsert: async ({ where, create, update }: {
        where: { reportHash: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const old = db.reports.get(where.reportHash);
        db.reports.set(where.reportHash, old ? { ...old, ...update } : create);
      },
    },
  },
}));
vi.mock('../src/outcomes/enumerate', () => ({ ensureOutcomeRows: vi.fn() }));

const { persistLaunchReports } = await import('../src/report/persist');
const draft = (id: string, launchId: string | null): ReportDraft => ({
  content: {
    version: 'report/v0', chainId: 4663, tokenAddress: '0x1111111111111111111111111111111111111111',
    launchId, reportTime: '2026-09-28T00:00:00.000Z', trigger: 'launch',
    blockPin: { number: 1, hash: `0x${'a'.repeat(64)}`, timestamp: '2026-09-28T00:00:00.000Z' },
    forecaster: 'det_v0', forecasterVersion: 'v0', outcomeRuleVersion: 'v1',
    probabilities: { 'TRADING_ALIVE@24h': 0.4 }, coverage: [],
  },
  canonicalJson: '{}', reportHash: `0x${id.repeat(64)}` as `0x${string}`,
  signature: null, signer: null, validatorPassed: true, validatorFailures: [],
});

beforeEach(() => {
  db.launches.clear();
  db.reports.clear();
  db.lookups = 0;
});

describe('report lane at first store', () => {
  it('stamps only finalized lanes, using one launch read for a batch', async () => {
    db.launches.set('final', {
      id: 'final', lane: 'qualified', feature: { t10ComputedAt: new Date('2026-09-28T00:11:00Z') },
      lpLockedByConstruction: false, retrospective: false,
    });
    db.launches.set('pending', {
      id: 'pending', lane: 'index', feature: { t10ComputedAt: null },
      lpLockedByConstruction: false, retrospective: false,
    });
    await persistLaunchReports([draft('a', 'final'), draft('b', 'pending'), draft('c', null)]);
    expect(db.lookups).toBe(1);
    expect(db.reports.get(`0x${'a'.repeat(64)}`)?.laneAtFirstStore).toBe('qualified');
    expect(db.reports.get(`0x${'b'.repeat(64)}`)?.laneAtFirstStore).toBeNull();
    expect(db.reports.get(`0x${'c'.repeat(64)}`)?.laneAtFirstStore).toBeNull();
  });

  it('does not rewrite an original lane on reportHash upsert after a lane change', async () => {
    const launch = {
      id: 'one', lane: 'index' as 'index' | 'qualified',
      feature: { t10ComputedAt: new Date('2026-09-28T00:11:00Z') },
      lpLockedByConstruction: false, retrospective: false,
    };
    db.launches.set('one', launch);
    const report = draft('d', 'one');
    await persistLaunchReports([report]);
    launch.lane = 'qualified';
    await persistLaunchReports([report]);
    expect(db.reports.get(report.reportHash)?.laneAtFirstStore).toBe('index');
  });
});
