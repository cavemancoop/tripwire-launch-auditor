import { Prisma, prisma, type $Enums } from '@launch-auditor/db';
import { resolveOneOutcome, type OutcomeRow, type ResolveClient } from './resolve';

export interface SweepResult {
  picked: number;
  resolved: number;
  na: number;
  unresolvable: number;
  retryLater: number;
  failed: number;
}

/** treat as transient and leave PENDING for the next sweep */
const RETRYABLE = /network|timeout|ETIMEDOUT|ECONNRESET|fetch failed|429|sweep error/i;

export interface SweepFilter {
  /** only resolve DRAWDOWN_80 + outcomes whose launch reached the qualified lane
   *  (checkpoint §C step 4: the heavy scans run on qualified launches only) */
  qualifiedOnly?: boolean;
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
      ...(filter.qualifiedOnly
        ? {
            OR: [
              { label: 'DRAWDOWN_80' as const },
              { label: 'TRADING_ALIVE' as const }, // both apply to every launch
              { launch: { lane: 'qualified' as const } },
            ],
          }
        : {}),
    },
    orderBy: { horizonAt: 'asc' },
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

  for (const row of due) {
    try {
      const res = await resolveOneOutcome(client, row as OutcomeRow);

      if (res.status === 'UNRESOLVABLE' && res.reason && RETRYABLE.test(res.reason)) {
        out.retryLater++;
        await prisma.outcome.update({
          where: { id: row.id },
          data: { measuredAt: new Date() }, // stay PENDING
        });
        continue;
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
      out.failed++;
      // eslint-disable-next-line no-console
      console.error(
        `[outcomes] ${row.label}@${row.horizon} ${row.tokenAddress} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
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
