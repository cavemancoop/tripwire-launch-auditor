import { describe, expect, it } from 'vitest';
import { recordDeepdiveSpend } from '../src/deepdive/cost';
import type { SpendStore } from '../src/metabolism/spend-ledger';

function fakeStore(): SpendStore & { rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    async findByGenerationId(id) {
      const hit = rows.find((r) => r.generationId === id);
      return hit ? { id: hit.id as string } : null;
    },
    async insert(row) {
      const id = `s${rows.length + 1}`;
      rows.push({ id, ...row });
      return { id };
    },
    async sum() {
      return rows.reduce((a, r) => a + (r.costUsd as number), 0);
    },
    async sumByKey() {
      return [];
    },
  };
}

const result = (over: Partial<{ generationIds: string[]; usageCostUsd: number | null }> = {}) => ({
  generationIds: over.generationIds ?? ['gen-a', 'gen-b'],
  modelSlug: 'x/y',
  usageCostUsd: over.usageCostUsd ?? 0.02,
});

describe('recordDeepdiveSpend', () => {
  it('records one MetabolismSpend row per generation, costed via lookup', async () => {
    const store = fakeStore();
    const costs: Record<string, number> = { 'gen-a': 0.012, 'gen-b': 0.008 };
    const out = await recordDeepdiveSpend(
      { result: result(), keyHashPrefix: 'kp1', reportId: 'r1' },
      { store, lookupCost: async (id) => costs[id]! },
    );
    expect(out.totalCostUsd).toBeCloseTo(0.02, 6);
    expect(out.rows.map((r) => r.costUsd)).toEqual([0.012, 0.008]);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]).toMatchObject({ model: 'x/y', keyHashPrefix: 'kp1', reportId: 'r1', generationId: 'gen-a' });
  });

  it('is idempotent — a re-run of the same generations adds nothing to the total', async () => {
    const store = fakeStore();
    const deps = { store, lookupCost: async () => 0.01 };
    await recordDeepdiveSpend({ result: result() }, deps);
    const second = await recordDeepdiveSpend({ result: result() }, deps);
    expect(second.rows.every((r) => r.deduped)).toBe(true);
    expect(second.totalCostUsd).toBe(0);
    expect(store.rows).toHaveLength(2);
  });

  it('skips a generation whose cost lookup fails (no row written)', async () => {
    const store = fakeStore();
    const out = await recordDeepdiveSpend(
      { result: result({ generationIds: ['ok', 'bad'] }) },
      {
        store,
        lookupCost: async (id) => {
          if (id === 'bad') throw new Error('404');
          return 0.05;
        },
      },
    );
    expect(out.failed).toEqual(['bad']);
    expect(store.rows).toHaveLength(1);
    expect(out.totalCostUsd).toBeCloseTo(0.05, 6);
  });

  it('falls back to the usage estimate when there are no generation ids', async () => {
    const store = fakeStore();
    const out = await recordDeepdiveSpend({ result: result({ generationIds: [], usageCostUsd: 0.04 }) }, { store });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.costUsd).toBe(0.04);
    expect(store.rows[0]!.generationId).toBeNull();
  });
});
