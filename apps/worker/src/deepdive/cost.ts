/**
 * Turn a completed deep-dive run into `MetabolismSpend` rows (M5b-3). One row
 * per OpenRouter generation, costed from `GET /generation?id=` (the authoritative
 * figure — CLAUDE.md), tagged with the gateway key's `keyHashPrefix` so the IDS
 * reconciler can attribute it. Idempotent on `generationId`.
 */
import type { WorkerEnv } from '../env';
import { recordSpend, type SpendStore } from '../metabolism/spend-ledger';
import { generationCost, type GenerationCostDeps } from './openrouter';
import type { DeepDiveResult } from './schema';

export interface RecordDeepdiveSpendInput {
  result: Pick<DeepDiveResult, 'generationIds' | 'modelSlug' | 'usageCostUsd'>;
  /** sha256(gateway key)[:12], from the Metabolism store */
  keyHashPrefix?: string | null;
  reportId?: string | null;
}

export interface RecordDeepdiveSpendDeps {
  env?: WorkerEnv;
  costDeps?: GenerationCostDeps;
  store?: SpendStore;
  /** override the per-generation cost lookup (tests) */
  lookupCost?: (id: string) => Promise<number>;
}

export interface RecordDeepdiveSpendResult {
  totalCostUsd: number;
  rows: Array<{ generationId: string; costUsd: number; id: string; deduped: boolean }>;
  /** generations whose cost lookup failed */
  failed: string[];
  /** first lookup error, for logging — the caller must not swallow this */
  failureReason?: string;
  /** true when the row(s) came from the streamed-usage estimate, not `GET /generation` */
  estimated?: boolean;
}

export async function recordDeepdiveSpend(
  input: RecordDeepdiveSpendInput,
  deps: RecordDeepdiveSpendDeps = {},
): Promise<RecordDeepdiveSpendResult> {
  const lookup =
    deps.lookupCost ??
    (async (id: string) => (await generationCost(id, deps.env, deps.costDeps)).totalCostUsd);

  const out: RecordDeepdiveSpendResult = { totalCostUsd: 0, rows: [], failed: [] };

  // No generation ids (e.g. a fully mocked run) — fall back to the usage estimate as one row.
  const ids = input.result.generationIds.length
    ? input.result.generationIds
    : input.result.usageCostUsd != null
      ? ['usage-estimate']
      : [];

  for (const id of ids) {
    let costUsd: number;
    try {
      costUsd = id === 'usage-estimate' ? (input.result.usageCostUsd ?? 0) : await lookup(id);
    } catch (err) {
      out.failed.push(id);
      out.failureReason ??= err instanceof Error ? err.message : String(err);
      continue;
    }
    const { id: rowId, deduped } = await recordSpend(
      {
        costUsd,
        model: input.result.modelSlug,
        keyHashPrefix: input.keyHashPrefix ?? null,
        reportId: input.reportId ?? null,
        generationId: id === 'usage-estimate' ? null : id,
      },
      deps.store,
    );
    out.rows.push({ generationId: id, costUsd, id: rowId, deduped });
    if (!deduped) out.totalCostUsd += costUsd;
  }

  // Every per-generation lookup failed (the Orbio gateway does not proxy
  // OpenRouter's `GET /generation` — it 404s), but the run still spent real
  // credits. Record the streamed-usage estimate as a single row rather than
  // leaving the ledger empty: an empty ledger reads as $0 spend to the IDS
  // reconciler, which would trip REVOKING and halt the agent. Flagged as an
  // estimate so the dashboard can say so.
  if (out.rows.length === 0 && out.failed.length > 0 && input.result.usageCostUsd != null) {
    const { id: rowId, deduped } = await recordSpend(
      {
        costUsd: input.result.usageCostUsd,
        model: input.result.modelSlug,
        keyHashPrefix: input.keyHashPrefix ?? null,
        reportId: input.reportId ?? null,
        generationId: null,
      },
      deps.store,
    );
    out.rows.push({ generationId: 'usage-estimate', costUsd: input.result.usageCostUsd, id: rowId, deduped });
    out.estimated = true;
    if (!deduped) out.totalCostUsd += input.result.usageCostUsd;
  }

  out.totalCostUsd = Math.round(out.totalCostUsd * 1e6) / 1e6;
  return out;
}
