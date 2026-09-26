import { Prisma, prisma, type $Enums } from '@launch-auditor/db';
import { classifyRpcError, hasProviderFailure, redactRpcDiagnostic } from '@launch-auditor/rpc-budget';
import { recordFailure } from '../failures';
import { loopMetrics, observeSafely, type LoopObserver } from '../loop-metrics';
import { DeadlineError, withDeadline } from '../watcher/retry';
import { claimRow, newClaimToken, unclaimedWhere, writeOwned } from './claim';
import { resolveOneOutcome, type OutcomeRow, type ResolveClient } from './resolve';

/** one outcome should never take longer than this; on timeout it stays PENDING
 *  for the next sweep (guards the backfill against a runaway scan) */
const OUTCOME_DEADLINE_MS = 120_000;

/** Package 4b (review d17cd0c4): how long one attempt owns its row. The claim is
 *  taken just before the row's resolution starts, which the deadline bounds; the
 *  margin covers the result write. A crashed owner's row is claimable after this. */
export const OUTCOME_LEASE_MS = OUTCOME_DEADLINE_MS + 3 * 60_000;

export interface SweepResult {
  picked: number;
  /** Package 2b: rows selected per outcome label (observation only) */
  pickedByLabel?: Partial<Record<string, number>>;
  resolved: number;
  na: number;
  unresolvable: number;
  retryLater: number;
  failed: number;
  /** Package 4b: selected rows another sweeper claimed first; no RPC was spent on them */
  claimSkipped?: number;
  /** Package 4b: attempts whose result write was refused because they no longer
   *  owned the row; counted in none of the result fields above */
  lostClaim?: number;
}

/** A deferred row is not picked again for this long. Without it, the oldest
 *  horizon-due rows that fail on RPC errors were re-picked every minute and took
 *  24 of 25 sweep slots, so ~1 outcome resolved per minute (2026-09-15). */
export const DEFAULT_RETRY_BACKOFF_MS = 30 * 60_000;
/** A row still failing on a transient error this long after its FIRST deferral
 *  becomes UNRESOLVABLE ("failed measurements are unresolvable, never an
 *  outcome", OUTCOME_RULES_v1). Measured from first deferral, not horizon, so
 *  the backfill's long-past horizons are not given up on at the first error. */
export const DEFAULT_GIVE_UP_AFTER_MS = 24 * 3_600_000;

export const ALL_OUTCOME_LABELS: $Enums.OutcomeLabel[] = [
  'INSIDER_EXIT',
  'SELL_IMPAIRED',
  'LIQ_IMPAIRED',
  'DRAWDOWN_80',
  'TRADING_ALIVE',
];

/** Pure: round-robin across per-label queues so no single label's backlog takes every slot. */
export function interleave<T>(groups: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < limit; i++) {
    let took = false;
    for (const g of groups) {
      if (i < g.length) {
        out.push(g[i]!);
        took = true;
        if (out.length >= limit) break;
      }
    }
    if (!took) break;
  }
  return out;
}

/** stored evidence is untrusted JSON: anything but a positive finite number is no pause */
function validPausedMs(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Pure: keep retrying a transient failure, or give up and record it as unresolvable.
 *  `quotaPausedMs` (review 896555be) is time on this clock spent in a provider
 *  quota outage; it does not count toward the give-up window. A restarted
 *  (missing or corrupt) clock carries no pause. */
export function deferOrGiveUp(
  firstDeferredAt: string | null | undefined,
  now: number,
  giveUpAfterMs: number = DEFAULT_GIVE_UP_AFTER_MS,
  quotaPausedMs: unknown = 0,
): { action: 'defer' | 'give_up'; firstDeferredAt: string } {
  const first =
    firstDeferredAt && !Number.isNaN(Date.parse(firstDeferredAt)) ? firstDeferredAt : new Date(now).toISOString();
  const paused = first === firstDeferredAt ? validPausedMs(quotaPausedMs) : 0;
  return { action: now - Date.parse(first) - paused >= giveUpAfterMs ? 'give_up' : 'defer', firstDeferredAt: first };
}

/** Pure (review 896555be): the quota pause on a started give-up clock after one
 *  more quota refusal. The whole interval since the row's previous attempt stamp
 *  (never before the clock started) ended in the refusal, so it is attributed to
 *  the outage — erring toward keeping a row PENDING, not toward terminal data
 *  loss. Time already counted before that stamp stays counted. With no clock or
 *  no stamp there is nothing to pause. */
export function accrueQuotaPause(
  firstDeferredAt: string | null | undefined,
  quotaPausedMs: unknown,
  lastAttemptAt: Date | null | undefined,
  now: number,
): number {
  const prior = validPausedMs(quotaPausedMs);
  const first = firstDeferredAt ? Date.parse(firstDeferredAt) : Number.NaN;
  const last = lastAttemptAt ? lastAttemptAt.getTime() : Number.NaN;
  if (Number.isNaN(first) || Number.isNaN(last)) return prior;
  return prior + Math.max(0, now - Math.max(first, last));
}

/** the one text the sweep has always retried that is no RPC failure kind; kept verbatim */
const SWEEP_ONLY_RETRY = /sweep error/i;

export type SweepDisposition = 'quota' | 'defer' | 'fail';

/** Pure (review 896555be): the sweep's mapping of the shared RPC taxonomy, for a
 *  thrown error or a resolver's UNRESOLVABLE reason. A quota refusal pauses the
 *  give-up clock; a deadline or any other provider-failure signal — even beside
 *  an archive miss or a revert — defers on it; anything else is the row's (or the
 *  code's) own result. */
export function sweepDisposition(err: unknown): SweepDisposition {
  if (classifyRpcError(err) === 'quota') return 'quota';
  if (err instanceof DeadlineError || hasProviderFailure(err)) return 'defer';
  return SWEEP_ONLY_RETRY.test(err instanceof Error ? err.message : String(err)) ? 'defer' : 'fail';
}

export interface SweepFilter {
  /** only resolve DRAWDOWN_80 + outcomes whose launch reached the qualified lane
   *  (checkpoint §C step 4: the heavy scans run on qualified launches only) */
  qualifiedOnly?: boolean;
  /** resolve this many outcomes at once. The shared RPC scheduler (token bucket)
   *  is the real rate limit, so concurrency just stops the loop being
   *  latency-bound — each outcome is ~80 sequential getLogs. Default 1 (the live
   *  worker loop); the backfill passes 8+. */
  concurrency?: number;
  /** restrict to these outcome labels (base-rate backfill: fill one sparse cell
   *  at a time instead of letting the oldest-horizon cell hog the run) */
  onlyLabels?: $Enums.OutcomeLabel[];
  /** skip these labels (e.g. deprioritise the slow INSIDER_EXIT@6h cell so the
   *  72h / 7d / TRADING_ALIVE cells get reached) */
  excludeLabels?: $Enums.OutcomeLabel[];
  /** oldest-horizon-first (default), a spread across cells via id order, or
   *  `fair`: oldest-first within each label, round-robin across labels */
  order?: 'horizon' | 'spread' | 'fair';
  /** skip rows deferred more recently than this (default 30 min) */
  retryBackoffMs?: number;
  /** transient failures this long after first deferral become UNRESOLVABLE (default 24h) */
  giveUpAfterMs?: number;
  /** only outcomes whose launch reached the qualified lane — for ALL labels,
   *  not just the heavy ones. ~87% of retrospective launches are non-qualified
   *  spam / token-vs-token / >10%-fee side pools whose DRAWDOWN/TRADING_ALIVE
   *  outcomes are unresolvable and would bias the base rate. */
  laneQualifiedOnly?: boolean;
  /** Package 4b: how long an attempt owns its row (default OUTCOME_LEASE_MS) */
  leaseMs?: number;
}

/** Resolve every PENDING outcome whose horizon has passed, up to `limit`. */
export async function sweepDueOutcomes(
  client: ResolveClient,
  limit = 25,
  filter: SweepFilter = {},
): Promise<SweepResult> {
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - (filter.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS));
  const giveUpAfterMs = filter.giveUpAfterMs ?? DEFAULT_GIVE_UP_AFTER_MS;
  const leaseMs = filter.leaseMs ?? OUTCOME_LEASE_MS;
  const where = {
      status: 'PENDING' as const,
      horizonAt: { lte: now },
      // a deferral stamps measuredAt on a still-PENDING row; wait out the backoff.
      // Package 4b: a row another attempt owns is not selected until its lease ends.
      AND: [{ OR: [{ measuredAt: null }, { measuredAt: { lt: retryCutoff } }] }, unclaimedWhere(now)],
      ...(filter.onlyLabels?.length ? { label: { in: filter.onlyLabels } } : {}),
      ...(filter.excludeLabels?.length ? { label: { notIn: filter.excludeLabels } } : {}),
      ...(filter.laneQualifiedOnly
        ? { launch: { lane: 'qualified' as const } }
        : filter.qualifiedOnly
          ? {
              OR: [
                { label: 'DRAWDOWN_80' as const },
                { label: 'TRADING_ALIVE' as const }, // both apply to every launch
                { launch: { lane: 'qualified' as const } },
              ],
            }
          : {}),
  };

  let due;
  if (filter.order === 'fair') {
    const labels = (filter.onlyLabels?.length ? filter.onlyLabels : ALL_OUTCOME_LABELS).filter(
      (l) => !filter.excludeLabels?.includes(l),
    );
    const groups = await Promise.all(
      labels.map((label) =>
        prisma.outcome.findMany({
          where: { ...where, label },
          orderBy: { horizonAt: 'asc' },
          take: limit,
        }),
      ),
    );
    due = interleave(groups, limit);
  } else {
    due = await prisma.outcome.findMany({
      where,
      orderBy: filter.order === 'spread' ? { id: 'asc' } : { horizonAt: 'asc' },
      take: limit,
    });
  }

  const pickedByLabel: Partial<Record<string, number>> = {};
  for (const row of due) pickedByLabel[row.label] = (pickedByLabel[row.label] ?? 0) + 1;

  const out: SweepResult = {
    picked: due.length,
    pickedByLabel,
    resolved: 0,
    na: 0,
    unresolvable: 0,
    retryLater: 0,
    failed: 0,
    claimSkipped: 0,
    lostClaim: 0,
  };

  type DeferEvidence = { firstDeferredAt?: string; deferrals?: number; quotaPausedMs?: number };

  /** Package 4b: this attempt's lease ended (or another attempt took the row) before its write */
  const claimLost = (row: (typeof due)[number], label: string, what: string) => {
    out.lostClaim!++;
    // eslint-disable-next-line no-console
    console.warn(`[outcomes] ${label} ${row.tokenAddress} ${what} not written: claim lost (lease expired or row taken over)`);
  };

  // `msg` is the raw error text (the caller has already classified it); only its
  // redacted form is stored or logged — viem messages carry the key-bearing RPC URL
  const deferRow = async (row: (typeof due)[number], token: string, label: string, msg: string) => {
    const safe = redactRpcDiagnostic(msg);
    const prior = (row.evidence ?? {}) as DeferEvidence;
    const at = Date.now();
    const d = deferOrGiveUp(prior.firstDeferredAt, at, giveUpAfterMs, prior.quotaPausedMs);
    // the pause belongs to the clock it was recorded on; a restarted clock drops it
    const quotaPausedMs = d.firstDeferredAt === prior.firstDeferredAt ? validPausedMs(prior.quotaPausedMs) : 0;
    const pause = quotaPausedMs > 0 ? { quotaPausedMs } : {};
    const deferrals = (prior.deferrals ?? 0) + 1;
    if (d.action === 'give_up') {
      const written = await writeOwned(row.id, token, {
        status: 'UNRESOLVABLE',
        value: null,
        evidence: {
          reason: `gave up after ${deferrals} transient failures since ${d.firstDeferredAt}: ${safe}`,
          firstDeferredAt: d.firstDeferredAt,
          deferrals,
          ...pause,
        } as Prisma.InputJsonValue,
        measuredAt: new Date(at),
      });
      if (!written) return claimLost(row, label, 'give-up');
      out.unresolvable++;
      // eslint-disable-next-line no-console
      console.warn(`[outcomes] ${label} ${row.tokenAddress} gave up (unresolvable) after ${deferrals} deferrals: ${safe}`);
      return;
    }
    // stay PENDING; measuredAt starts the backoff, evidence carries the give-up clock
    const written = await writeOwned(row.id, token, {
      measuredAt: new Date(at),
      evidence: {
        firstDeferredAt: d.firstDeferredAt,
        deferrals,
        ...pause,
        lastError: safe.slice(0, 300),
      } as Prisma.InputJsonValue,
    });
    if (!written) return claimLost(row, label, 'deferral');
    out.retryLater++;
    // eslint-disable-next-line no-console
    console.warn(`[outcomes] ${label} ${row.tokenAddress} deferred (${deferrals}): ${safe}`);
  };

  /** Package 4a: the provider's quota ran out (18 Sep); nothing about this row
   *  failed. Stay PENDING with the backoff stamp, but neither start the give-up
   *  clock, count a deferral, nor give up — an outage longer than the give-up
   *  window must not turn due rows UNRESOLVABLE. A clock an earlier transient
   *  failure started keeps its start time and its counted retry time, and the
   *  outage is recorded as a pause on it (review 896555be), so a transient
   *  failure after recovery does not find the outage charged to the row. */
  const deferOnQuota = async (row: (typeof due)[number], token: string, label: string, msg: string) => {
    const safe = redactRpcDiagnostic(msg);
    const prior = (row.evidence ?? {}) as DeferEvidence;
    const at = Date.now();
    const quotaPausedMs = accrueQuotaPause(prior.firstDeferredAt, prior.quotaPausedMs, row.measuredAt, at);
    const written = await writeOwned(row.id, token, {
      measuredAt: new Date(at),
      evidence: {
        ...(prior.firstDeferredAt !== undefined ? { firstDeferredAt: prior.firstDeferredAt } : {}),
        ...(prior.deferrals !== undefined ? { deferrals: prior.deferrals } : {}),
        ...(quotaPausedMs > 0 ? { quotaPausedMs } : {}),
        lastError: safe.slice(0, 300),
      } as Prisma.InputJsonValue,
    });
    if (!written) return claimLost(row, label, 'quota deferral');
    out.retryLater++;
    // eslint-disable-next-line no-console
    console.warn(`[outcomes] ${label} ${row.tokenAddress} deferred on provider quota (give-up clock not advanced): ${safe}`);
  };

  const resolveRow = async (row: (typeof due)[number]): Promise<void> => {
    const label = `${row.label}@${row.horizon}`;
    // Package 4b (review d17cd0c4): own the row before any RPC. The claim is one
    // statement that re-checks the sweep's selection, so a row graded, deferred
    // or claimed by another sweeper since this sweep read it is skipped.
    const token = newClaimToken();
    try {
      if (!(await claimRow(row.id, token, where, leaseMs))) {
        out.claimSkipped!++;
        return;
      }
    } catch (err) {
      out.failed++;
      // eslint-disable-next-line no-console
      console.error(`[outcomes] ${label} ${row.tokenAddress} claim failed:`, redactRpcDiagnostic(err instanceof Error ? err.message : String(err)));
      await recordFailure('outcomes.claim_failed', err);
      return;
    }

    try {
      // Package 4b (review d17cd0c4): a timed-out row is deferred and its late
      // result discarded, so the RPC its resolution would still issue is
      // cancelled rather than spent — no next chunk, retry or queued request.
      const res = await withDeadline(
        () => resolveOneOutcome(client, row as OutcomeRow),
        OUTCOME_DEADLINE_MS,
        `${row.label}@${row.horizon} ${row.tokenAddress}`,
        { cancelRpc: true },
      );

      const reasonDisposition = res.status === 'UNRESOLVABLE' && res.reason ? sweepDisposition(res.reason) : 'fail';
      if (reasonDisposition !== 'fail') {
        // the classified reason decides retryability; the raw RPC message is only for the log
        const raw = (res.evidence as { rpcError?: string } | undefined)?.rpcError;
        const text = raw ? `${res.reason} — ${raw}` : res.reason!;
        if (reasonDisposition === 'quota') await deferOnQuota(row, token, label, text);
        else await deferRow(row, token, label, text);
        return;
      }

      const status = res.status as $Enums.OutcomeStatus;
      const rpcError = (res.evidence as { rpcError?: unknown } | undefined)?.rpcError;
      const written = await writeOwned(row.id, token, {
        status,
        value: res.value,
        evidence: {
          ...(res.reason ? { reason: redactRpcDiagnostic(res.reason) } : {}),
          ...res.evidence,
          ...(typeof rpcError === 'string' ? { rpcError: redactRpcDiagnostic(rpcError) } : {}),
        } as unknown as Prisma.InputJsonValue,
        coverage: res.coverage
          ? (res.coverage as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        measuredAt: new Date(),
      });
      if (!written) return claimLost(row, label, status);

      if (status === 'RESOLVED') out.resolved++;
      else if (status === 'NA') out.na++;
      else out.unresolvable++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const disposition = sweepDisposition(err);
      if (disposition === 'quota') {
        await deferOnQuota(row, token, label, msg);
        return;
      }
      if (disposition === 'defer') {
        await deferRow(row, token, label, msg);
        return;
      }
      // back off a code-path failure too, or it takes a slot every sweep forever; never give up on it
      let backedOff: boolean;
      try {
        backedOff = await writeOwned(row.id, token, { measuredAt: new Date() });
      } catch (writeError) {
        out.failed++;
        await recordFailure('outcomes.resolve_failed', writeError);
        return;
      }
      if (!backedOff) return claimLost(row, label, 'failed backoff');
      out.failed++;
      // eslint-disable-next-line no-console
      console.error(
        `[outcomes] ${row.label}@${row.horizon} ${row.tokenAddress} failed:`,
        redactRpcDiagnostic(msg),
      );
      await recordFailure('outcomes.resolve_failed', err);
    }
  };

  const concurrency = Math.max(1, filter.concurrency ?? 1);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, due.length) }, async () => {
    while (cursor < due.length) {
      const row = due[cursor++]!;
      await resolveRow(row);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface OutcomesLoopOptions {
  intervalMs?: number;
  batch?: number;
  /** outcomes resolved in parallel per sweep. The shared RPC token bucket (watcher >
   *  commit > outcomes) is the real rate limit, so this only stops the loop being
   *  latency-bound: at 1, one sweep of 25 took ~5 min (2026-09-15). */
  concurrency?: number;
  /** INSIDER_EXIT / SELL_IMPAIRED / LIQ_IMPAIRED resolve for qualified-lane
   *  launches only; DRAWDOWN_80 / TRADING_ALIVE stay universal. Env:
   *  OUTCOMES_QUALIFIED_ONLY. Off by default (current behavior unchanged). */
  qualifiedOnly?: boolean;
  /** injectable for tests — defaults to the real `sweepDueOutcomes` (hits Prisma) */
  sweep?: typeof sweepDueOutcomes;
  /** Package 2b: loop observation; defaults to the process `loopMetrics` */
  observer?: LoopObserver;
  /** injectable clock for sweep timing (ms) */
  now?: () => number;
}

export async function runOutcomesLoop(
  client: ResolveClient,
  signal: { stopped: boolean },
  opts: OutcomesLoopOptions = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 60_000;
  const batch = opts.batch ?? Number(process.env.OUTCOMES_BATCH || 25);
  const concurrency = opts.concurrency ?? Number(process.env.OUTCOMES_CONCURRENCY || 4);
  const sweep = opts.sweep ?? sweepDueOutcomes;
  const observer = opts.observer ?? loopMetrics;
  const clock = opts.now ?? Date.now;
  // 2026-09-15: every index-lane launch (the ~87% that never clear the qualified
  // bar) still gets INSIDER_EXIT / SELL_IMPAIRED / LIQ_IMPAIRED rows created
  // (spec §1's "applies to: all" for INSIDER_EXIT), and INSIDER_EXIT resolution
  // costs ~80 sequential getLogs vs ~2 quoter calls for SELL_IMPAIRED — so a
  // shared RPC budget spends most of itself resolving outcomes for tokens
  // nobody qualified to buy. Off by default: identical behavior until opted in.
  // DRAWDOWN_80 / TRADING_ALIVE stay universal either way (backfill's own
  // qualifiedOnly semantics, reused here) — they apply to every launch by spec.
  const qualifiedOnly = opts.qualifiedOnly ?? /^(1|true|yes)$/i.test(process.env.OUTCOMES_QUALIFIED_ONLY || '');
  // eslint-disable-next-line no-console
  console.log(
    `[outcomes] resolution loop every ${intervalMs / 1000}s, batch ${batch}, concurrency ${concurrency}, ` +
      `fair across labels${qualifiedOnly ? ', qualified-lane only for INSIDER_EXIT/SELL_IMPAIRED/LIQ_IMPAIRED' : ''}`,
  );
  while (!signal.stopped) {
    const started = clock();
    try {
      const r = await sweep(client, batch, { order: 'fair', concurrency, qualifiedOnly });
      const ms = clock() - started;
      observeSafely(() => observer.outcomeSweep(ms, r, clock()));
      if (r.picked > 0) {
        const contended = (r.claimSkipped ?? 0) + (r.lostClaim ?? 0);
        // eslint-disable-next-line no-console
        console.log(
          `[outcomes] swept ${r.picked}: ${r.resolved} resolved · ${r.na} n/a · ${r.unresolvable} unresolvable · ${r.retryLater} retry · ${r.failed} error` +
            `${contended > 0 ? ` · ${r.claimSkipped ?? 0} claimed elsewhere · ${r.lostClaim ?? 0} claim lost` : ''} in ${(ms / 1000).toFixed(1)}s`,
        );
      }
    } catch (err) {
      observeSafely(() => observer.outcomeSweep(clock() - started, undefined, clock()));
      // eslint-disable-next-line no-console
      console.error('[outcomes] sweep error', redactRpcDiagnostic(err instanceof Error ? err.message : String(err)));
      await recordFailure('outcomes.sweep_error', err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
