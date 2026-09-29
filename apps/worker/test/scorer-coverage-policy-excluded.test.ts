import { describe, expect, it, vi } from 'vitest';

const groupBy = vi.hoisted(() => vi.fn());
vi.mock('@launch-auditor/db', () => ({ prisma: { outcome: { groupBy } } }));

import { prismaCoverageReader } from '../src/scorer/coverage';

describe('benchmark coverage with policy exclusions', () => {
  it('keeps excluded rows separate from due, not-due and measured rows', async () => {
    groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      if (by.includes('status')) return [
        { label: 'INSIDER_EXIT', horizon: '24h', status: 'PENDING', _count: { _all: 12 } },
        { label: 'INSIDER_EXIT', horizon: '24h', status: 'RESOLVED', _count: { _all: 3 } },
        { label: 'INSIDER_EXIT', horizon: '24h', status: 'POLICY_EXCLUDED', _count: { _all: 40 } },
      ];
      return [{ label: 'INSIDER_EXIT', horizon: '24h', _count: { _all: 10 } }];
    });

    const coverage = await prismaCoverageReader(new Date('2026-09-29T00:00:00Z'));
    expect(coverage['INSIDER_EXIT@24h']).toEqual({
      resolved: 3, pendingDue: 10, pendingNotDue: 2,
      unresolvable: 0, na: 0, policyExcluded: 40, retrospectiveResolved: 10,
    });
  });
});
