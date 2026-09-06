import { describe, expect, it } from 'vitest';
import { scoreBenchmark, type ScoreRow } from '../src/scorer';

/** det_v0 ~85% discriminating, base_rate near-random with small jitter (non-degenerate). */
function rows(n: number): ScoreRow[] {
  const out: ScoreRow[] = [];
  for (let i = 0; i < n; i++) {
    const label = i % 2 === 0;
    const obsId = `tok${i}@t`;
    const trigger = i < n / 2 ? 'launch' : 'qualified';
    const source = i % 3 === 0 ? 'pons' : 'raw';
    const detWrong = i % 7 === 0;
    const detProb =
      label !== detWrong ? 0.62 + (i % 5) * 0.02 : 0.38 - (i % 5) * 0.02;
    const brProb = 0.4 + ((i % 4) - 1.5) * 0.02;
    out.push({ obsId, forecaster: 'det_v0', outcomeKey: 'DRAWDOWN_80@24h', trigger, source, prob: detProb, label });
    out.push({ obsId, forecaster: 'base_rate', outcomeKey: 'DRAWDOWN_80@24h', trigger, source, prob: brProb, label });
  }
  return out;
}

describe('scoreBenchmark', () => {
  it('produces an all section plus trigger and source splits', () => {
    const b = scoreBenchmark(rows(20));
    expect(b.sections.find((s) => s.splitBy === 'all')).toBeDefined();
    expect(b.sections.filter((s) => s.splitBy === 'trigger').map((s) => s.splitValue).sort()).toEqual([
      'launch',
      'qualified',
    ]);
    expect(b.sections.filter((s) => s.splitBy === 'source').map((s) => s.splitValue).sort()).toEqual([
      'pons',
      'raw',
    ]);
  });

  it('ranks the better forecaster first and gates claims on sample size', () => {
    const all = scoreBenchmark(rows(20)).sections.find((s) => s.splitBy === 'all')!;
    const cells = all.byOutcome['DRAWDOWN_80@24h']!;
    expect(cells[0]!.forecaster).toBe('det_v0');
    expect(cells[0]!.auroc!).toBeGreaterThan(0.7);
    expect(cells[0]!.insufficientSample).toBe(true); // n=20 < 100
    const cmp = cells[0]!.comparisons.find((c) => c.vs === 'base_rate')!;
    expect(cmp.claimAllowed).toBe(false); // n < 200
    expect(cmp.note).toMatch(/insufficient sample/);
  });

  it('allows a claim once n >= 200 and the gap is significant', () => {
    const all = scoreBenchmark(rows(240)).sections.find((s) => s.splitBy === 'all')!;
    const det = all.byOutcome['DRAWDOWN_80@24h']!.find((c) => c.forecaster === 'det_v0')!;
    expect(det.insufficientSample).toBe(false);
    const cmp = det.comparisons.find((c) => c.vs === 'base_rate')!;
    expect(cmp.aucDiff! > 0).toBe(true);
    expect(cmp.p! < 0.05).toBe(true);
    expect(cmp.claimAllowed).toBe(true);
  });
});
