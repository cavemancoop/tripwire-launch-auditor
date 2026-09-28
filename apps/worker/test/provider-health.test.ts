import { describe, expect, it } from 'vitest';
import { ProviderHealthTracker } from '../src/provider-health';

const stats = (attempts: number, providerFailures = 0, quotaFailures = 0) =>
  ({ attempts, providerFailures, quotaFailures });

describe('ProviderHealthTracker', () => {
  it('uses attempted requests as the denominator and applies a strict 5% threshold', () => {
    const tracker = new ProviderHealthTracker();
    expect(tracker.sample(stats(0))).toBeNull();
    expect(tracker.sample(stats(100, 5))).toBeNull();
    expect(tracker.sample(stats(200, 11))?.bad).toBe(true); // 6/100
    expect(tracker.sample(stats(300, 16))?.bad).toBe(true); // one healthy window, still bad
    expect(tracker.sample(stats(400, 21))?.bad).toBe(false); // second healthy window
  });

  it('treats any quota refusal as bad even below the 5% rate threshold', () => {
    const tracker = new ProviderHealthTracker();
    const result = tracker.sample(stats(1000, 1, 1));
    expect(result?.bad).toBe(true);
    expect(result?.detail).toContain('1 quota refusal;');
  });

  it('does not recover merely because no calls occurred', () => {
    const tracker = new ProviderHealthTracker();
    tracker.sample(stats(100, 10));
    expect(tracker.sample(stats(100, 10))?.bad).toBe(true);
    expect(tracker.sample(stats(200, 10))?.bad).toBe(true);
    expect(tracker.sample(stats(200, 10))?.bad).toBe(true);
    expect(tracker.sample(stats(300, 10))?.bad).toBe(false);
  });

  it('does not infer recovery from a counter reset or malformed snapshot', () => {
    const tracker = new ProviderHealthTracker();
    tracker.sample(stats(100, 10));
    expect(tracker.sample(stats(0))).toBeNull();
    expect(tracker.sample(stats(50))?.bad).toBe(true);
    expect(tracker.sample(stats(50, 60, 0))).toBeNull();
  });

  it('keeps the valid baseline after NaN rather than inventing a healthy window', () => {
    const tracker = new ProviderHealthTracker();
    expect(tracker.sample(stats(100, 10))?.bad).toBe(true);
    expect(tracker.sample(stats(Number.NaN, 0))?.bad).toBeUndefined();
    expect(tracker.sample(stats(200, 60))?.bad).toBe(true); // 50/100, not NaN
    expect(tracker.sample(stats(300, 60))?.bad).toBe(true);
    expect(tracker.sample(stats(400, 60))?.bad).toBe(false);
  });
});
