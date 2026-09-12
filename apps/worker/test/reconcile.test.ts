import { describe, expect, it } from 'vitest';
import { deepdiveRunGate } from '../src/metabolism/budget';
import { billingBlocksInference, reconcileEpoch, type EpochInput } from '../src/metabolism/reconcile';

const epoch = (over: Partial<EpochInput> = {}): EpochInput => ({
  providerSpendNowUsd: 10.43,
  providerSpendPrevUsd: 10,
  localEstimateUsd: 0.412,
  requestCount: 37,
  anomalyPct: 50,
  phantomToleranceUsd: 0.005,
  ...over,
});

describe('reconcileEpoch — provider delta vs local estimates (M5c)', () => {
  it('grades the estimator: factor and signed discrepancy', () => {
    const r = reconcileEpoch(epoch());
    expect(r.providerDeltaUsd).toBeCloseTo(0.43, 6);
    expect(r.localEstimateUsd).toBeCloseTo(0.412, 6);
    expect(r.reconciliationFactor).toBeCloseTo(0.43 / 0.412, 4);
    expect(r.discrepancyPct).toBeCloseTo(4.37, 1);
    expect(r.anomaly).toBe(false);
    expect(r.phantom).toBe(false);
    expect(r.billingStatus).toBe('aggregate_only');
  });

  it('a ledger/provider gap is an ANOMALY that pauses — never a revoke', () => {
    // estimator says $0.10, provider charged $0.40: +300%
    const r = reconcileEpoch(epoch({ providerSpendNowUsd: 10.4, localEstimateUsd: 0.1, requestCount: 3 }));
    expect(r.anomaly).toBe(true);
    expect(r.phantom).toBe(false);
    expect(r.billingStatus).toBe('anomaly');
    expect(r.reason).toMatch(/estimator anomaly/);
  });

  it('PHANTOM: provider spend rose with zero local requests', () => {
    const r = reconcileEpoch(epoch({ providerSpendNowUsd: 10.02, localEstimateUsd: 0, requestCount: 0 }));
    expect(r.phantom).toBe(true);
    expect(r.billingStatus).toBe('phantom');
    expect(r.reason).toMatch(/phantom spend/);
  });

  it('a sub-tolerance drift with zero requests is rounding noise, not phantom', () => {
    const r = reconcileEpoch(epoch({ providerSpendNowUsd: 10.004, localEstimateUsd: 0, requestCount: 0 }));
    expect(r.phantom).toBe(false);
    expect(r.billingStatus).toBe('aggregate_only');
    expect(r.reason).toMatch(/idle/);
  });

  it('requests ran but nothing could be priced → unavailable, not anomaly, not 0', () => {
    const r = reconcileEpoch(epoch({ localEstimateUsd: 0, requestCount: 5 }));
    expect(r.billingStatus).toBe('unavailable');
    expect(r.reconciliationFactor).toBeNull();
    expect(r.discrepancyPct).toBeNull();
    expect(r.anomaly).toBe(false);
    expect(r.providerDeltaUsd).toBeCloseTo(0.43, 6);
  });

  it('provider reporting less than the estimate is a negative discrepancy, still reconciled', () => {
    const r = reconcileEpoch(epoch({ providerSpendNowUsd: 10.3, localEstimateUsd: 0.412 }));
    expect(r.discrepancyPct).toBeLessThan(0);
    expect(r.anomaly).toBe(false);
    expect(r.reconciliationFactor).toBeCloseTo(0.3 / 0.412, 4);
  });

  it('a provider counter that went backwards clamps the delta to zero', () => {
    const r = reconcileEpoch(epoch({ providerSpendNowUsd: 9.9, requestCount: 2, localEstimateUsd: 0.02 }));
    expect(r.providerDeltaUsd).toBe(0);
    expect(r.reconciliationFactor).toBeNull();
    expect(r.phantom).toBe(false);
  });
});

describe('billingBlocksInference', () => {
  it('blocks on anomaly and phantom only', () => {
    expect(billingBlocksInference('anomaly')).toBe(true);
    expect(billingBlocksInference('phantom')).toBe(true);
    expect(billingBlocksInference('aggregate_only')).toBe(false);
    expect(billingBlocksInference('unavailable')).toBe(false);
    expect(billingBlocksInference('exact')).toBe(false);
    expect(billingBlocksInference(null)).toBe(false);
  });
});

describe('deepdiveRunGate — M5c billing controls', () => {
  const IN = { capPerRunUsd: 0.2, dailyCapUsd: 5, todaySpendUsd: 0, spendableUsd: 40 };

  it('an anomaly or phantom billing state closes the gate without touching the key', () => {
    for (const billingStatus of ['anomaly', 'phantom'] as const) {
      const g = deepdiveRunGate({ ...IN, billingStatus });
      expect(g.allowed).toBe(false);
      expect(g.maxRunCostUsd).toBe(0);
      expect(g.reason).toMatch(/paused/);
    }
  });

  it('aggregate_only / unavailable / null leave the gate open', () => {
    for (const billingStatus of ['aggregate_only', 'unavailable', null] as const) {
      expect(deepdiveRunGate({ ...IN, billingStatus }).allowed).toBe(true);
    }
  });

  it('the daily cap is enforced against the LARGER of local estimate and provider spend', () => {
    // local ledger thinks $1 spent, the provider says $5 — the provider wins
    const g = deepdiveRunGate({ ...IN, todaySpendUsd: 1, providerSpendTodayUsd: 5 });
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/daily cap/);
    expect(g.reason).toMatch(/\$5/);
    // and the reverse: a stale provider figure does not hide local spend
    expect(deepdiveRunGate({ ...IN, todaySpendUsd: 5, providerSpendTodayUsd: 0.5 }).allowed).toBe(false);
  });
});
