import { baseRate } from './base-rate';
import { fastDeLong } from './delong';
import {
  auprc,
  auroc,
  brierScore,
  brierSkill,
  ece,
  logLoss,
  precisionRecallAt,
} from './metrics';
import type { OutcomeKey } from './types';

/** spec §12 */
export const MIN_FOR_METRICS = 100;
export const MIN_FOR_CLAIMS = 200;
/**
 * A cell can clear 200 observations and still be almost entirely one class —
 * `INSIDER_EXIT@6h` sat at n=336 with 12 positives (base rate 0.036) on
 * 2026-09-14. AUROC on a dozen positives is noise, so a significant-looking
 * DeLong gap there is not a result worth publishing. The rule was written down
 * in the field report but never enforced here, which meant the only cell that
 * could trip the gate was the one least worth trusting.
 */
export const MIN_POSITIVES_FOR_CLAIMS = 30;

/** One forecaster's prediction for one resolved outcome of one launch. */
export interface ScoreRow {
  /** stable per-observation id (e.g. `${token}@${anchorTime}`) — aligns forecasters for DeLong */
  obsId: string;
  forecaster: string;
  outcomeKey: OutcomeKey;
  trigger: string;
  source: string;
  prob: number;
  label: boolean;
}

export interface Comparison {
  vs: string;
  aucDiff: number | null;
  z: number | null;
  p: number | null;
  /** spec §2: significant AUROC gap (DeLong) on >= 200 resolved */
  claimAllowed: boolean;
  note: string;
}

export interface ForecasterCell {
  forecaster: string;
  n: number;
  positives: number;
  baseRate: number;
  auroc: number | null;
  auprc: number | null;
  logLoss: number | null;
  brier: number | null;
  brierSkill: number | null;
  ece: number | null;
  pr: Array<{ threshold: number; precision: number | null; recall: number | null }>;
  insufficientSample: boolean;
  comparisons: Comparison[];
}

export interface BenchmarkSection {
  splitBy: 'all' | 'trigger' | 'source';
  splitValue: string;
  byOutcome: Partial<Record<OutcomeKey, ForecasterCell[]>>;
}

export interface Benchmark {
  generatedAt: string;
  thresholds: number[];
  minForMetrics: number;
  minForClaims: number;
  minPositivesForClaims: number;
  sections: BenchmarkSection[];
}

export interface ScoreOptions {
  thresholds?: number[];
  /** baselines every other forecaster is DeLong-compared against */
  baselines?: string[];
  now?: () => Date;
}

function alignByObs(a: ScoreRow[], b: ScoreRow[]): { pa: number[]; pb: number[]; y: boolean[] } {
  const bm = new Map(b.map((r) => [r.obsId, r]));
  const pa: number[] = [];
  const pb: number[] = [];
  const y: boolean[] = [];
  for (const r of a) {
    const m = bm.get(r.obsId);
    if (!m) continue;
    pa.push(r.prob);
    pb.push(m.prob);
    y.push(r.label);
  }
  return { pa, pb, y };
}

function cell(
  forecaster: string,
  rows: ScoreRow[],
  peers: Map<string, ScoreRow[]>,
  baselines: string[],
  thresholds: number[],
): ForecasterCell {
  const probs = rows.map((r) => r.prob);
  const labels = rows.map((r) => r.label);
  const positives = labels.reduce((n, y) => n + (y ? 1 : 0), 0);
  const br = baseRate(labels);
  const brier = brierScore(probs, labels);
  const refBrier = brierScore(labels.map(() => br), labels); // base-rate constant predictor
  const insufficient = rows.length < MIN_FOR_METRICS;

  const comparisons: Comparison[] = [];
  for (const base of baselines) {
    if (base === forecaster) continue;
    const bRows = peers.get(base);
    if (!bRows) continue;
    const { pa, pb, y } = alignByObs(rows, bRows);
    const dl = fastDeLong(pa, pb, y);
    if (!dl) {
      comparisons.push({ vs: base, aucDiff: null, z: null, p: null, claimAllowed: false, note: 'insufficient overlap / single class' });
      continue;
    }
    const enoughPositives = positives >= MIN_POSITIVES_FOR_CLAIMS;
    const claimAllowed =
      y.length >= MIN_FOR_CLAIMS && enoughPositives && dl.p < 0.05 && dl.diff > 0;
    comparisons.push({
      vs: base,
      aucDiff: round4(dl.diff),
      z: round4(dl.z),
      p: round4(dl.p),
      claimAllowed,
      note:
        y.length < MIN_FOR_CLAIMS
          ? `insufficient sample (${y.length} < ${MIN_FOR_CLAIMS})`
          : !enoughPositives
            ? `insufficient positives (${positives} < ${MIN_POSITIVES_FOR_CLAIMS})`
            : claimAllowed
              ? 'significant AUROC gain'
              : dl.diff <= 0
                ? 'no gain'
                : 'not significant',
    });
  }

  return {
    forecaster,
    n: rows.length,
    positives,
    baseRate: round4(br),
    auroc: nullableRound(auroc(probs, labels)),
    auprc: nullableRound(auprc(probs, labels)),
    logLoss: nullableRound(logLoss(probs, labels)),
    brier: nullableRound(brier),
    brierSkill: brier !== null && refBrier !== null ? nullableRound(brierSkill(brier, refBrier)) : null,
    ece: nullableRound(ece(probs, labels)),
    pr: thresholds.map((t) => {
      const r = precisionRecallAt(probs, labels, t);
      return { threshold: t, precision: nullableRound(r.precision), recall: nullableRound(r.recall) };
    }),
    insufficientSample: insufficient,
    comparisons,
  };
}

function sectionFor(
  splitBy: BenchmarkSection['splitBy'],
  splitValue: string,
  rows: ScoreRow[],
  baselines: string[],
  thresholds: number[],
): BenchmarkSection {
  const byOutcome: Partial<Record<OutcomeKey, ForecasterCell[]>> = {};
  const outcomeKeys = [...new Set(rows.map((r) => r.outcomeKey))];
  for (const ok of outcomeKeys) {
    const okRows = rows.filter((r) => r.outcomeKey === ok);
    const peers = new Map<string, ScoreRow[]>();
    for (const r of okRows) {
      const list = peers.get(r.forecaster) ?? [];
      list.push(r);
      peers.set(r.forecaster, list);
    }
    byOutcome[ok] = [...peers.entries()]
      .map(([f, fr]) => cell(f, fr, peers, baselines, thresholds))
      .sort((a, b) => (b.auroc ?? 0) - (a.auroc ?? 0));
  }
  return { splitBy, splitValue, byOutcome };
}

/** Build the full benchmark table (spec §2): all rows, then split by trigger, then by source. */
export function scoreBenchmark(rows: ScoreRow[], opts: ScoreOptions = {}): Benchmark {
  const thresholds = opts.thresholds ?? [0.5];
  const baselines = opts.baselines ?? ['base_rate', 'heuristic_v1'];
  const now = (opts.now ?? (() => new Date()))();

  const sections: BenchmarkSection[] = [sectionFor('all', 'all', rows, baselines, thresholds)];
  for (const trig of [...new Set(rows.map((r) => r.trigger))].sort()) {
    sections.push(sectionFor('trigger', trig, rows.filter((r) => r.trigger === trig), baselines, thresholds));
  }
  for (const src of [...new Set(rows.map((r) => r.source))].sort()) {
    sections.push(sectionFor('source', src, rows.filter((r) => r.source === src), baselines, thresholds));
  }

  return {
    generatedAt: now.toISOString(),
    thresholds,
    minForMetrics: MIN_FOR_METRICS,
    minForClaims: MIN_FOR_CLAIMS,
    minPositivesForClaims: MIN_POSITIVES_FOR_CLAIMS,
    sections,
  };
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const nullableRound = (x: number | null): number | null => (x === null ? null : round4(x));
