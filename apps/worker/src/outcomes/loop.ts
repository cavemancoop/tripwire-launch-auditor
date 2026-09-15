import { Prisma, prisma, type $Enums } from '@launch-auditor/db';
import { DeadlineError, withDeadline } from '../watcher/retry';
import { resolveOneOutcome, type OutcomeRow, type ResolveClient } from './resolve';

/** one outcome should never take longer than this; on timeout it stays PENDING
 *  for the next sweep (guards the backfill against a runaway scan) */
const OUTCOME_DEADLINE_MS = 120_000;

export interface SweepResult {
  picked: number;
  resolved: number;
  na: number;
  unresolvable: number;
  retryLater: number;
  failed: number;
}

/** treat as transient and leave PENDING for the next sweep */
const RETRYABLE =
  /network|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|429|rate.?limit|too many requests|request limit|network is busy|-32005|-32097|capacity|throttl|sweep error/i;

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
  /** oldest-horizon-first (default) or a spread across cells via id order */
  order?: 'horizon' | 'spread';
  /** only outcomes whose launch reached the qualified lane — for ALL labels,
   *  not just the heavy ones. ~87% of retrospective launches are non-qualified
   *  spam / token-vs-token / >10%-fee side pools whose DRAWDOWN/TRADING_ALIVE
   *  outcomes are unresolvable and would bias the base rate. */
  laneQualifiedOnly?: boolean;
}

/** Resolve every PENDING outcome whose horizon has passed, up to `limit`. */
export async function sweepDueOutcomes(
  client: ResolveClient,
  limit = 25,
  filter: SweepFilter = {},
): Promise<SweepResult> {
  const due = await prisma.outcome.findMany({
    where: {
      status: 'PENDING',
      horizonAt: { lte: new Date() },
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
    },
    orderBy: filter.order === 'spread' ? { id: 'asc' } : { horizonAt: 'asc' },
    take: limit,
  });

  const out: SweepResult = {
    picked: due.length,
    resolved: 0,
    na: 0,
    unresolvable: 0,
    retryLater: 0,
    failed: 0,
  };

  const deferRow = async (id: string, label: string, tokenAddress: string, msg: string) => {
    out.retryLater++;
    await prisma.outcome.update({ where: { id }, data: { measuredAt: new Date() } }); // stay PENDING
    // eslint-disable-next-line no-console
    console.warn(`[outcomes] ${label} ${tokenAddress} deferred: ${msg}`);
  };

  const resolveRow = async (row: (typeof due)[number]): Promise<void> => {
    try {
      const res = await withDeadline(
        () => resolveOneOutcome(client, row as OutcomeRow),
        OUTCOME_DEADLINE_MS,
        `${row.label}@${row.horizon} ${row.tokenAddress}`,
      );

      if (res.status === 'UNRESOLVABLE' && res.reason && RETRYABLE.test(res.reason)) {
        await deferRow(row.id, `${row.label}@${row.horizon}`, row.tokenAddress, res.reason);
        return;
      }

      const status = res.status as $Enums.OutcomeStatus;
      await prisma.outcome.update({
        where: { id: row.id },
        data: {
          status,
          value: res.value,
          evidence: {
            ...(res.reason ? { reason: res.reason } : {}),
            ...res.evidence,
          } as unknown as Prisma.InputJsonValue,
          coverage: res.coverage
            ? (res.coverage as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          measuredAt: new Date(),
        },
      });

      if (status === 'RESOLVED') out.resolved++;
      else if (status === 'NA') out.na++;
      else out.unresolvable++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof DeadlineError || RETRYABLE.test(msg)) {
        await deferRow(row.id, `${row.label}@${row.horizon}`, row.tokenAddress, msg);
        return;
      }
      out.failed++;
      // eslint-disable-next-line no-console
      console.error(
        `[outcomes] ${row.label}@${row.horizon} ${row.tokenAddress} failed:`,
        err instanceof Error ? err.message : err,
      );
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
}

export async function runOutcomesLoop(
  client: ResolveClient,
  signal: { stopped: boolean },
  opts: OutcomesLoopOptions = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 60_000;
  const batch = opts.batch ?? 25;
  // eslint-disable-next-line no-console
  console.log(`[outcomes] resolution loop every ${intervalMs / 1000}s, batch ${batch}`);
  while (!signal.stopped) {
    try {
      const r = await sweepDueOutcomes(client, batch);
      if (r.picked > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[outcomes] swept ${r.picked}: ${r.resolved} resolved · ${r.na} n/a · ${r.unresolvable} unresolvable · ${r.retryLater} retry · ${r.failed} error`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[outcomes] sweep error', err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
