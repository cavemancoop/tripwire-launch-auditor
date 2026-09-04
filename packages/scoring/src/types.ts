/** Outcome horizons used across spec §1. */
export type Horizon = '1h' | '6h' | '24h' | '72h' | '7d';

export type OutcomeLabel =
  | 'INSIDER_EXIT'
  | 'SELL_IMPAIRED'
  | 'LIQ_IMPAIRED'
  | 'DRAWDOWN_80';

/** Canonical key for a scored cell, e.g. "INSIDER_EXIT@24h". */
export type OutcomeKey = `${OutcomeLabel}@${Horizon}`;

export function outcomeKey(label: OutcomeLabel, horizon: Horizon): OutcomeKey {
  return `${label}@${horizon}`;
}

export interface ForecastRow {
  launchId: string;
  forecaster: string;
  /** OutcomeKey -> probability in [0, 1]. Missing keys = not forecast. */
  probabilities: Partial<Record<OutcomeKey, number>>;
}

export interface ResolvedLabel {
  launchId: string;
  key: OutcomeKey;
  value: boolean;
}

/** Metrics reported per (outcome, horizon, forecaster) — spec §2. */
export interface Metrics {
  n: number;
  auroc: number | null;
  auprc: number | null;
  logLoss: number | null;
  brier: number | null;
  brierSkillScore: number | null;
  ece: number | null;
}
