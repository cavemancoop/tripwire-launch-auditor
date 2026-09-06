import { describe, expect, it } from 'vitest';
import { DET_V0_1_OVERRIDES, detV0, detV0_1, logit, mergeDetV01 } from '../src/det';
import type { FeatureInputs } from '../src/inputs';

const base = (o: Partial<FeatureInputs> = {}): FeatureInputs => ({
  source: 'raw',
  lpLockedByConstruction: false,
  creatorDevbuyPct: 3,
  creatorAgeDays: 10,
  creatorPriorLaunches: null,
  creatorPriorInsiderExitRate: null,
  clusterSize: null,
  launchBlockClusterSize: null,
  clusterSupplyPct: 12,
  top10NoncreatorPct: 30,
  uniqueBuyers10m: 40,
  buysPerBuyer10m: null,
  microbuyShare10m: null,
  liquidityUsd10m: null,
  sellImpactBps: null,
  hasX: null,
  hasSite: null,
  verified: null,
  ownerRenounced: null,
  mintable: null,
  sellSimOk: null,
  sellTaxBps: null,
  hookCanBlockSwap: null,
  hookCanTaxSwap: null,
  hookGatesLpRemoval: null,
  sidePoolCount: null,
  creatorApprovalsOutsideRouters: null,
  ...o,
});

describe('logit', () => {
  it('is the inverse of sigmoid at the usual points', () => {
    expect(logit(0.5)).toBeCloseTo(0, 6);
    expect(logit(0.7310585786)).toBeCloseTo(1, 5);
  });
});

describe('det_v0.1', () => {
  it('equals det_v0 while biasOverride is empty (but is a distinct version label)', () => {
    expect(DET_V0_1_OVERRIDES.biasOverride).toEqual({});
    const a = detV0(base());
    const b = detV0_1(base());
    expect(b.version).toBe('det_v0.1');
    expect(b.probabilities).toEqual(a.probabilities);
  });

  it('mergeDetV01 replaces only the overridden intercept, keeping weights', () => {
    const merged = mergeDetV01(undefined, {
      version: 'det_v0.1',
      basedOn: 'det_v0',
      biasOverride: { 'DRAWDOWN_80@24h': 5 },
    });
    expect(merged.outcomes['DRAWDOWN_80@24h']!.bias).toBe(5);
    expect(merged.outcomes['DRAWDOWN_80@24h']!.weights).toEqual(
      detV0(base()).probabilities && merged.outcomes['DRAWDOWN_80@24h']!.weights,
    );
    // an untouched outcome keeps det_v0's bias
    expect(merged.outcomes['INSIDER_EXIT@24h']!.bias).toBe(-1.6);
    // and the override pushes that cell's probability up
    const p = detV0(base(), merged).probabilities['DRAWDOWN_80@24h']!;
    expect(p).toBeGreaterThan(0.9);
  });
});
