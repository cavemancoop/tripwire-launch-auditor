import { describe, expect, it } from 'vitest';
import { goplusToProbabilities, scanhoodToProbabilities } from '../src/mappings';
import { ALL_OUTCOME_KEYS } from '../src/types';

describe('scanhoodToProbabilities', () => {
  it('is empty for a missing scan', () => {
    expect(scanhoodToProbabilities(null)).toEqual({});
  });

  it('rates a honeypot high across the board and pins SELL_IMPAIRED', () => {
    const p = scanhoodToProbabilities({ verdict: 'honeypot', sellable: false, verified: false });
    for (const k of ALL_OUTCOME_KEYS) expect(p[k]!).toBeGreaterThan(0.5);
    expect(p['SELL_IMPAIRED@24h']!).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...Object.values(p))).toBeLessThanOrEqual(0.97);
  });

  it('rates a clean token low', () => {
    const p = scanhoodToProbabilities({ verdict: 'safe', sellable: true, verified: true, deployer: { launches: 12 } });
    for (const k of ALL_OUTCOME_KEYS) expect(p[k]!).toBeLessThan(0.2);
  });
});

describe('goplusToProbabilities', () => {
  it('is empty for a missing scan', () => {
    expect(goplusToProbabilities(undefined)).toEqual({});
  });

  it('elevates risk when honeypot / mintable flags are set', () => {
    const risky = goplusToProbabilities({ is_honeypot: '1', is_mintable: '1', sell_tax: '0.25' });
    const clean = goplusToProbabilities({});
    expect(risky['DRAWDOWN_80@24h']!).toBeGreaterThan(clean['DRAWDOWN_80@24h']!);
    expect(risky['SELL_IMPAIRED@1h']!).toBeGreaterThan(0.4);
    expect(Math.max(...Object.values(risky))).toBeLessThanOrEqual(0.97);
  });

  it('keeps a flag-free token near the base rate', () => {
    const p = goplusToProbabilities({ is_honeypot: '0' });
    for (const k of ALL_OUTCOME_KEYS) expect(p[k]!).toBeLessThan(0.1);
  });
});
