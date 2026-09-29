import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), launches: vi.fn() }));
vi.mock('@launch-auditor/db', async (original) => ({
  ...(await original<typeof import('@launch-auditor/db')>()),
  prisma: { $queryRaw: db.query, launch: { findMany: db.launches } },
}));

import { launchContext, loadLaunchContexts, readReportsForResolved } from '../src/scorer/read';

describe('bounded scorer reads', () => {
  it('selects exact resolved observation keys and preserves nullable report relations', async () => {
    db.query.mockResolvedValueOnce([{
      chainId: 4663, tokenAddress: '0xabc', reportTime: new Date('2026-09-18T00:00:00Z'),
      trigger: 'launch', forecaster: 'det_v0', launchId: 'L1', commitId: 'C1',
      launchSource: 'raw', commitBlockNumber: 123n, pInsiderExit24h: 0.5,
    }]);
    const rows = await readReportsForResolved('live');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokenAddress: '0xabc', launch: { source: 'raw' }, commit: { blockNumber: 123n },
      pInsiderExit24h: 0.5,
    });
    expect(rows[0]).not.toHaveProperty('launchSource');
    const query = db.query.mock.calls[0]![0] as { sql: string; values: unknown[] };
    expect(query.sql).toContain('o.status = \'RESOLVED\' AND o.value IS NOT NULL');
    expect(query.sql).toContain('lower(r."tokenAddress") = k.token');
    expect(query.sql).toContain('r."reportTime" = k."anchorTime"');
    expect(query.sql).toContain('r."validatorPassed" = true');
    expect(query.values).toEqual([false]);

    db.query.mockResolvedValueOnce([{ chainId: 4663, tokenAddress: '0xdef', reportTime: new Date(),
      trigger: 'launch', forecaster: 'det_v0', launchId: null, commitId: null,
      launchSource: null, commitBlockNumber: null }]);
    const unlinked = await readReportsForResolved('retrospective');
    expect(unlinked[0]).toMatchObject({ launch: null, commit: null });
    expect((db.query.mock.calls[1]![0] as { values: unknown[] }).values).toEqual([true]);

    db.query.mockResolvedValueOnce([]);
    await readReportsForResolved('both');
    expect((db.query.mock.calls[2]![0] as { values: unknown[] }).values).toEqual([]);
  });

  it('fetches a fresh launch context in bounded chunks and keeps missing links unknown', async () => {
    db.launches.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.filter((id) => id !== 'scorer-read-missing').map((id) => ({ id, source: 'raw', lane: 'qualified' })));
    const ids = Array.from({ length: 1201 }, (_, i) => `scorer-read-${i}`);
    const contexts = await loadLaunchContexts([...ids, 'scorer-read-missing', null]);
    expect(db.launches.mock.calls.map(([arg]) => arg.where.id.in.length)).toEqual([500, 500, 202]);
    expect(launchContext(contexts, ids[1200]!)).toEqual({ source: 'raw', lane: 'qualified' });
    expect(launchContext(contexts, 'scorer-read-missing')).toEqual({ source: 'unknown', lane: 'unknown' });
    expect(launchContext(contexts, null)).toEqual({ source: 'unknown', lane: 'unknown' });
    db.launches.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, source: 'raw', lane: 'index' })));
    const refreshed = await loadLaunchContexts([ids[1200]!]);
    expect(launchContext(refreshed, ids[1200]!).lane).toBe('index');
    expect(launchContext(contexts, ids[1200]!).lane).toBe('qualified');
  });
});
