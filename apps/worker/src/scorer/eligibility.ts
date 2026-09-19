/**
 * Which report-outcome pairs may count toward a benchmark claim.
 *
 * The headline claim is "the forecast was committed before its outcome".
 * `reportTime` is the T+10m *block* time (report/assemble.ts), not when the
 * report was issued, so a report built late — the 18 Sep outage replay, the
 * 16 Sep 6.8h backlog — carries an anchor from before it existed. The 2026-09-19
 * independent audit found one committed 11h36m after its anchor, after two of
 * its horizons had ended, and the scorer counted such rows like any other.
 *
 * Time is the commit's *chain block time*, never the DB's receipt-recording
 * `committedAt` (which trailed the block by ~5 min in the audit's sample).
 * Signed reports are never edited or re-anchored: ineligible rows are
 * excluded from claims and counted, not rewritten.
 */

export type Eligibility = 'eligible' | 'replay' | 'late' | 'uncommitted' | 'missing_time';

export const ELIGIBILITY_CLASSES: Eligibility[] = ['eligible', 'replay', 'late', 'uncommitted', 'missing_time'];

/**
 * A normal commit lands 1–15 min after the T+10m anchor (5-min batches). Later
 * than this and the report was built late, with part of its outcome window
 * already observable, even if the horizon hadn't ended.
 */
export const REPLAY_AFTER_MS = 30 * 60_000;

export interface EligibilityInput {
  reportTime: Date;
  committed: boolean;
  /** block timestamp of the commit tx; null when committed but not readable */
  commitBlockTime: Date | null;
  horizonEnd: Date;
}

export function classifyEligibility(i: EligibilityInput): Eligibility {
  if (!i.committed) return 'uncommitted';
  if (!i.commitBlockTime) return 'missing_time';
  if (i.commitBlockTime.getTime() >= i.horizonEnd.getTime()) return 'late';
  if (i.commitBlockTime.getTime() - i.reportTime.getTime() > REPLAY_AFTER_MS) return 'replay';
  return 'eligible';
}

/**
 * Scanner baselines (ScanHood, GoPlus) are fetched when the T+10m job runs.
 * On a late job that's hours after launch — e.g. ScanHood's liquidity after a
 * rug — so a late fetch is hindsight, whatever the report's own eligibility.
 */
export function scannerFetchIsTimely(reportTime: Date, fetchedAt: Date | null): boolean {
  return fetchedAt !== null && fetchedAt.getTime() - reportTime.getTime() <= REPLAY_AFTER_MS;
}

export type ExclusionCounts = Record<string, Record<string, Partial<Record<Eligibility, number>>>>;

/** counts[outcomeKey][forecaster][class] += 1 */
export function countExclusion(counts: ExclusionCounts, outcomeKey: string, forecaster: string, e: Eligibility): void {
  const byF = (counts[outcomeKey] ??= {});
  const byE = (byF[forecaster] ??= {});
  byE[e] = (byE[e] ?? 0) + 1;
}
