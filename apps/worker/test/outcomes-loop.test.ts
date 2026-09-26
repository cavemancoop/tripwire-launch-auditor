import { describe, expect, it } from 'vitest';
import { DEFAULT_GIVE_UP_AFTER_MS, accrueQuotaPause, deferOrGiveUp, interleave } from '../src/outcomes/loop';

// 2026-09-15: 24 of every 25 sweep slots went to the same SELL_IMPAIRED@1h rows,
// deferred on an RPC error and re-picked next minute, so nine of eleven cells
// never filled. These pin the two rules that stop one label starving the rest.

describe('interleave — one label cannot take every slot', () => {
  it('round-robins across labels, oldest-first within each', () => {
    const sell = ['s1', 's2', 's3', 's4', 's5'];
    const insider = ['i1', 'i2'];
    const drawdown = ['d1'];
    expect(interleave([sell, insider, drawdown], 6)).toEqual(['s1', 'i1', 'd1', 's2', 'i2', 's3']);
  });

  it('fills remaining slots from whichever labels still have rows', () => {
    expect(interleave([['a1', 'a2', 'a3'], []], 3)).toEqual(['a1', 'a2', 'a3']);
  });

  it('stops when every queue is exhausted', () => {
    expect(interleave([['a1'], ['b1']], 25)).toEqual(['a1', 'b1']);
    expect(interleave([[], []], 25)).toEqual([]);
  });
});

describe('deferOrGiveUp — transient failures end as unresolvable, not forever', () => {
  const now = Date.parse('2026-09-15T12:00:00Z');

  it('first deferral starts the clock and defers', () => {
    expect(deferOrGiveUp(undefined, now)).toEqual({ action: 'defer', firstDeferredAt: '2026-09-15T12:00:00.000Z' });
  });

  it('keeps the original clock on later deferrals', () => {
    const first = '2026-09-15T01:00:00.000Z';
    expect(deferOrGiveUp(first, now)).toEqual({ action: 'defer', firstDeferredAt: first });
  });

  it('gives up once the give-up window since the FIRST deferral has passed', () => {
    const first = new Date(now - DEFAULT_GIVE_UP_AFTER_MS).toISOString();
    expect(deferOrGiveUp(first, now).action).toBe('give_up');
  });

  it('a corrupt clock restarts instead of giving up immediately', () => {
    expect(deferOrGiveUp('not a date', now).action).toBe('defer');
  });

  // review 896555be: quota-outage time is not retry time
  it('quota-paused time does not count toward the window; the rest still does', () => {
    const first = new Date(now - 50 * 3_600_000).toISOString();
    expect(deferOrGiveUp(first, now, DEFAULT_GIVE_UP_AFTER_MS, 48 * 3_600_000).action).toBe('defer');
    expect(deferOrGiveUp(first, now, DEFAULT_GIVE_UP_AFTER_MS, 26 * 3_600_000).action).toBe('give_up');
  });

  it('ignores a malformed pause, and a restarted clock carries none', () => {
    const first = new Date(now - DEFAULT_GIVE_UP_AFTER_MS).toISOString();
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, '9e9', null, undefined]) {
      expect(deferOrGiveUp(first, now, DEFAULT_GIVE_UP_AFTER_MS, bad).action).toBe('give_up');
    }
    expect(deferOrGiveUp(undefined, now, 0, 10 * DEFAULT_GIVE_UP_AFTER_MS).action).toBe('give_up');
  });
});

describe('accrueQuotaPause — outage time on a started clock', () => {
  const H = 3_600_000;
  const t0 = Date.parse('2026-09-18T00:00:00Z');
  const first = new Date(t0).toISOString();

  it('adds the interval since the previous attempt stamp to the recorded pause', () => {
    expect(accrueQuotaPause(first, undefined, new Date(t0), t0 + H)).toBe(H);
    expect(accrueQuotaPause(first, 5 * H, new Date(t0 + 10 * H), t0 + 11 * H)).toBe(6 * H);
  });

  it('never pauses time before the clock started', () => {
    expect(accrueQuotaPause(first, 0, new Date(t0 - 5 * H), t0 + H)).toBe(H);
  });

  it('no clock or no stamp: nothing accrues, the recorded pause is kept', () => {
    expect(accrueQuotaPause(undefined, 0, new Date(t0), t0 + H)).toBe(0);
    expect(accrueQuotaPause('not a date', 0, new Date(t0), t0 + H)).toBe(0);
    expect(accrueQuotaPause(first, 2 * H, null, t0 + H)).toBe(2 * H);
  });

  it('a stamp in the future adds nothing', () => {
    expect(accrueQuotaPause(first, H, new Date(t0 + 5 * H), t0 + 4 * H)).toBe(H);
  });
});
