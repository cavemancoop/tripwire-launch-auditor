/**
 * Package 2b — outcomes and scorer loop observation (docs/FABLE-REVIEW-IMPLEMENTATION.md).
 * Process-local counters the two loops report to after every pass, served next
 * to the 2a series on the worker's private `/metrics`. Fixed label sets only
 * (23 series): never a token address, row id or error message. Observers are
 * called through `observeSafely`, so a broken observer cannot change a loop.
 */
import type { SweepResult } from './outcomes/loop';

export const OUTCOME_LABELS = [
  'INSIDER_EXIT',
  'SELL_IMPAIRED',
  'LIQ_IMPAIRED',
  'DRAWDOWN_80',
  'TRADING_ALIVE',
  'other',
] as const;
export type OutcomeLabelKey = (typeof OUTCOME_LABELS)[number];

export const ROW_RESULTS = ['resolved', 'na', 'unresolvable', 'retry', 'failed', 'claim_skipped', 'lost_claim'] as const;
export type RowResult = (typeof ROW_RESULTS)[number];

export const LOOPS = ['outcomes', 'scorer'] as const;
export type LoopName = (typeof LOOPS)[number];

const labelKey = (label: string): OutcomeLabelKey =>
  (OUTCOME_LABELS as readonly string[]).includes(label) ? (label as OutcomeLabelKey) : 'other';

export interface LoopObserver {
  /** one outcomes sweep ended: `result` when it returned, undefined when it threw */
  outcomeSweep(durationMs: number, result: SweepResult | undefined, atMs: number): void;
  /** one scorer snapshot pass ended */
  scorerPass(ok: boolean, atMs: number): void;
}

export interface LoopMetricsSnapshot {
  /** every sweep attempt, returned or thrown; duration is recorded for both */
  sweeps: number;
  sweepErrors: number;
  lastSweepSeconds: number;
  sweepSecondsSum: number;
  /** rows selected, only from sweeps that returned */
  picked: Record<OutcomeLabelKey, number>;
  rows: Record<RowResult, number>;
  iterations: Record<LoopName, number>;
  errors: Record<LoopName, number>;
  /** unix seconds of the last pass that completed; 0 = never */
  lastSuccessSeconds: Record<LoopName, number>;
}

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

const emptySnapshot = (): LoopMetricsSnapshot => ({
  sweeps: 0,
  sweepErrors: 0,
  lastSweepSeconds: 0,
  sweepSecondsSum: 0,
  picked: zeros(OUTCOME_LABELS),
  rows: zeros(ROW_RESULTS),
  iterations: zeros(LOOPS),
  errors: zeros(LOOPS),
  lastSuccessSeconds: zeros(LOOPS),
});

export class LoopMetrics implements LoopObserver {
  private s = emptySnapshot();

  outcomeSweep(durationMs: number, result: SweepResult | undefined, atMs: number): void {
    const secs = Math.max(0, durationMs) / 1000;
    this.s.sweeps++;
    this.s.lastSweepSeconds = secs;
    this.s.sweepSecondsSum += secs;
    this.pass('outcomes', result !== undefined, atMs);
    if (!result) {
      this.s.sweepErrors++;
      return;
    }
    // a sweep without the per-label split still keeps the picked total
    const byLabel = result.pickedByLabel ?? { other: result.picked };
    for (const [label, n] of Object.entries(byLabel)) this.s.picked[labelKey(label)] += n ?? 0;
    this.s.rows.resolved += result.resolved;
    this.s.rows.na += result.na;
    this.s.rows.unresolvable += result.unresolvable;
    this.s.rows.retry += result.retryLater;
    this.s.rows.failed += result.failed;
    this.s.rows.claim_skipped += result.claimSkipped ?? 0;
    this.s.rows.lost_claim += result.lostClaim ?? 0;
  }

  scorerPass(ok: boolean, atMs: number): void {
    this.pass('scorer', ok, atMs);
  }

  snapshot(): LoopMetricsSnapshot {
    return structuredClone(this.s);
  }

  private pass(loop: LoopName, ok: boolean, atMs: number): void {
    this.s.iterations[loop]++;
    if (ok) this.s.lastSuccessSeconds[loop] = atMs / 1000;
    else this.s.errors[loop]++;
  }
}

/** The worker process's loop metrics, read by `/metrics`. */
export const loopMetrics = new LoopMetrics();

/** Run an observer call; anything it throws is dropped so the loop carries on unchanged. */
export function observeSafely(fn: () => void): void {
  try {
    fn();
  } catch {
    // observation must never affect the worker
  }
}

/** Pure: Prometheus text exposition (0.0.4) of the loop metrics. */
export function formatLoopMetrics(s: LoopMetricsSnapshot): string {
  const lines: string[] = [];
  const head = (name: string, type: string, help: string) =>
    lines.push(`# HELP tripwire_worker_${name} ${help}`, `# TYPE tripwire_worker_${name} ${type}`);
  const one = (name: string, type: string, help: string, v: number) => {
    head(name, type, help);
    lines.push(`tripwire_worker_${name} ${v}`);
  };
  const by = <K extends string>(name: string, type: string, help: string, label: string, keys: readonly K[], m: Record<K, number>) => {
    head(name, type, help);
    for (const k of keys) lines.push(`tripwire_worker_${name}{${label}="${k}"} ${m[k]}`);
  };
  one('outcome_sweeps_total', 'counter', 'outcome sweeps attempted (returned or thrown)', s.sweeps);
  one('outcome_sweep_errors_total', 'counter', 'outcome sweeps that threw', s.sweepErrors);
  one('outcome_sweep_last_duration_seconds', 'gauge', 'duration of the most recent outcome sweep', s.lastSweepSeconds);
  one('outcome_sweep_duration_seconds_sum', 'counter', 'total seconds spent in outcome sweeps', s.sweepSecondsSum);
  by('outcome_picked_total', 'counter', 'outcome rows selected by sweeps that returned, by label', 'label', OUTCOME_LABELS, s.picked);
  by('outcome_rows_total', 'counter', 'outcome rows handled by sweeps that returned, by result', 'result', ROW_RESULTS, s.rows);
  by('loop_iterations_total', 'counter', 'loop passes, by loop', 'loop', LOOPS, s.iterations);
  by('loop_errors_total', 'counter', 'loop passes that threw, by loop', 'loop', LOOPS, s.errors);
  by('loop_last_success_timestamp_seconds', 'gauge', 'unix time of the last completed pass (0 = never), by loop', 'loop', LOOPS, s.lastSuccessSeconds);
  return `${lines.join('\n')}\n`;
}
