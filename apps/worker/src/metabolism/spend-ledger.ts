/**
 * M5b-3 — the `MetabolismSpend` ledger: one row per `llm_deepdive_v0` run, the
 * local half of the IDS check (spec §8). The spender is the M6 deep-dive; M6
 * wires the call sites. Here we provide the write + read surface and keep it
 * idempotent on the OpenRouter `generationId` so a retried generation is never
 * double-counted.
 */
import { prisma } from '@launch-auditor/db';

export interface SpendEntry {
  costUsd: number;
  /** pinned model slug the cost is for */
  model: string;
  /** sha256(gateway key)[:12] — ties the spend to a key generation for IDS */
  keyHashPrefix?: string | null;
  reportId?: string | null;
  /** OpenRouter generation id — the idempotency key */
  generationId?: string | null;
}

export interface SpendFilter {
  since?: Date;
  keyHashPrefix?: string;
}

/** Storage seam so the ledger is unit-testable without Postgres. */
export interface SpendStore {
  findByGenerationId(generationId: string): Promise<{ id: string } | null>;
  insert(row: {
    costUsd: number;
    model: string;
    keyHashPrefix: string | null;
    reportId: string | null;
    generationId: string | null;
  }): Promise<{ id: string }>;
  sum(filter: SpendFilter): Promise<number>;
  sumByKey(): Promise<Array<{ keyHashPrefix: string | null; totalUsd: number }>>;
}

export const prismaSpendStore: SpendStore = {
  findByGenerationId: (generationId) =>
    prisma.metabolismSpend.findFirst({ where: { generationId }, select: { id: true } }),
  insert: (row) => prisma.metabolismSpend.create({ data: row, select: { id: true } }),
  sum: async (filter) => {
    const agg = await prisma.metabolismSpend.aggregate({
      _sum: { costUsd: true },
      where: {
        ...(filter.since ? { at: { gte: filter.since } } : {}),
        ...(filter.keyHashPrefix ? { keyHashPrefix: filter.keyHashPrefix } : {}),
      },
    });
    return agg._sum.costUsd ?? 0;
  },
  sumByKey: async () => {
    const rows = await prisma.metabolismSpend.groupBy({
      by: ['keyHashPrefix'],
      _sum: { costUsd: true },
    });
    return rows.map((r) => ({ keyHashPrefix: r.keyHashPrefix, totalUsd: r._sum.costUsd ?? 0 }));
  },
};

/** Record one deep-dive's spend. Idempotent when `generationId` is supplied. */
export async function recordSpend(
  entry: SpendEntry,
  store: SpendStore = prismaSpendStore,
): Promise<{ id: string; deduped: boolean }> {
  if (!Number.isFinite(entry.costUsd) || entry.costUsd < 0) {
    throw new Error(`recordSpend: costUsd must be a finite, non-negative number (got ${entry.costUsd})`);
  }
  if (!entry.model) throw new Error('recordSpend: model is required');

  if (entry.generationId) {
    const existing = await store.findByGenerationId(entry.generationId);
    if (existing) return { id: existing.id, deduped: true };
  }

  const { id } = await store.insert({
    costUsd: entry.costUsd,
    model: entry.model,
    keyHashPrefix: entry.keyHashPrefix ?? null,
    reportId: entry.reportId ?? null,
    generationId: entry.generationId ?? null,
  });
  return { id, deduped: false };
}

/** Σ costUsd, optionally since a time and/or for one key generation. */
export function totalSpendUsd(
  filter: SpendFilter = {},
  store: SpendStore = prismaSpendStore,
): Promise<number> {
  return store.sum(filter);
}

/** Per-`keyHashPrefix` spend totals (observability + the per-key IDS view). */
export async function spendByKey(
  store: SpendStore = prismaSpendStore,
): Promise<Map<string | null, number>> {
  const rows = await store.sumByKey();
  return new Map(rows.map((r) => [r.keyHashPrefix, r.totalUsd]));
}
