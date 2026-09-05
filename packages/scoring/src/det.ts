import weightsJson from '../weights/det_v0.json';
import { type FeatureInputs, type FeatureName, sigmoid, standardize } from './inputs';
import type { OutcomeKey } from './types';
import { ALL_OUTCOME_KEYS, outcomeApplies } from './types';

// `det_v0` (spec §4): one hand-set logistic per outcome/horizon over the
// standardized feature vector. Weights are frozen in weights/det_v0.json and
// committed before live operation; det_v1 re-fits them from the backfill.

export interface OutcomeWeights {
  bias: number;
  weights: Partial<Record<FeatureName, number>>;
}

export interface DetWeights {
  version: string;
  note?: string;
  outcomes: Partial<Record<OutcomeKey, OutcomeWeights>>;
}

export const DET_V0_WEIGHTS: DetWeights = weightsJson as DetWeights;

export interface DetV0Result {
  version: string;
  probabilities: Partial<Record<OutcomeKey, number>>;
}

export function detV0(
  inputs: FeatureInputs,
  weights: DetWeights = DET_V0_WEIGHTS,
): DetV0Result {
  const z = standardize(inputs);
  const probabilities: Partial<Record<OutcomeKey, number>> = {};

  for (const key of ALL_OUTCOME_KEYS) {
    if (!outcomeApplies(key, inputs)) continue;
    const w = weights.outcomes[key];
    if (!w) continue;
    let logit = w.bias;
    for (const [name, coef] of Object.entries(w.weights)) {
      if (coef === undefined) continue;
      logit += coef * (z[name as FeatureName] ?? 0);
    }
    probabilities[key] = round4(sigmoid(logit));
  }

  return { version: weights.version, probabilities };
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
