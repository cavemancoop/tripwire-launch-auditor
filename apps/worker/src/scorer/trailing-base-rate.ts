/** Rolling outcome prevalence among observations strictly before an anchor. */
const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

export interface TimedOutcome {
  t: number;
  y: boolean;
}

interface IndexedOutcomes {
  rows: TimedOutcome[];
  positives: Uint32Array;
}

/** First row whose timestamp is at least `at`; equal-time labels stay out. */
function lowerBound(rows: TimedOutcome[], at: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (rows[mid]!.t < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Index each outcome cell once; queries then take O(log n) instead of scanning
 * every earlier row for every scored observation. The caller owns the arrays,
 * which are sorted in place, as in the former collector implementation.
 */
export function buildTrailingBaseRate(
  byKey: Record<string, TimedOutcome[]>,
): (key: string, at: number) => number {
  const indexed = new Map<string, IndexedOutcomes>();
  for (const [key, rows] of Object.entries(byKey)) {
    rows.sort((a, b) => a.t - b.t);
    const positives = new Uint32Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) {
      positives[i + 1] = positives[i]! + (rows[i]!.y ? 1 : 0);
    }
    indexed.set(key, { rows, positives });
  }
  return (key, at) => {
    const cell = indexed.get(key);
    if (!cell) return 0;
    const end = lowerBound(cell.rows, at);
    if (end === 0) return 0;
    const start = lowerBound(cell.rows, at - THIRTY_DAYS_MS);
    const count = end - start;
    // Preserve the old behavior when the last 30 days have no observations:
    // use all earlier rows, and never include labels at the same anchor.
    return count > 0
      ? (cell.positives[end]! - cell.positives[start]!) / count
      : cell.positives[end]! / end;
  };
}
