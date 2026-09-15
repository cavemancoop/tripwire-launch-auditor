import { describe, expect, it } from 'vitest';
import { budgetDisplay } from '../src/budget-display';

const BASE = {
  dailyCapUsd: 5,
  capPerRunUsd: 0.2,
  spentTrailing24hUsd: 0,
  keyRemainingUsd: 10,
  reserveUsd: 3,
};

describe('budgetDisplay', () => {
  it('binds on cap_per_run when the per-run cap is the smallest candidate', () => {
    const b = budgetDisplay(BASE);
    expect(b.maxRunCostUsd).toBe(0.2);
    expect(b.bindingConstraint).toBe('cap_per_run');
  });

  it('binds on daily_cap when today\'s remaining budget is smaller than the per-run cap', () => {
    const b = budgetDisplay({ ...BASE, spentTrailing24hUsd: 4.9 });
    expect(b.remainingTodayUsd).toBe(0.1);
    expect(b.maxRunCostUsd).toBe(0.1);
    expect(b.bindingConstraint).toBe('daily_cap');
  });

  it('binds on spendable_key when the key has less left than the reserve plus the other caps allow', () => {
    const b = budgetDisplay({ ...BASE, keyRemainingUsd: 3.1, capPerRunUsd: 5, dailyCapUsd: 5 });
    expect(b.spendableKeyUsd).toBe(0.1);
    expect(b.maxRunCostUsd).toBe(0.1);
    expect(b.bindingConstraint).toBe('spendable_key');
  });

  it('reports zero when the key is at or under reserve', () => {
    const b = budgetDisplay({ ...BASE, keyRemainingUsd: 2, reserveUsd: 3 });
    expect(b.spendableKeyUsd).toBe(0);
    expect(b.maxRunCostUsd).toBe(0);
    expect(b.bindingConstraint).toBe('zero');
  });

  it('closes the gate to zero on anomaly or phantom billing status regardless of the numbers', () => {
    const anomaly = budgetDisplay({ ...BASE, billingStatus: 'anomaly' });
    const phantom = budgetDisplay({ ...BASE, billingStatus: 'phantom' });
    expect(anomaly.maxRunCostUsd).toBe(0);
    expect(anomaly.gateClosedByBilling).toBe(true);
    expect(phantom.maxRunCostUsd).toBe(0);
    expect(phantom.gateClosedByBilling).toBe(true);
  });

  it('does not close the gate on exact / aggregate_only / unavailable billing status', () => {
    for (const status of ['exact', 'aggregate_only', 'unavailable', null, undefined]) {
      const b = budgetDisplay({ ...BASE, billingStatus: status });
      expect(b.gateClosedByBilling).toBe(false);
    }
  });
});

describe('budgetDisplay — staleness is reported, not enforced', () => {
  // Mirrors the worker gate: a lapsed Orbio session means nobody has re-read
  // the balance, not that anything is wrong. The gateway key bills fine
  // without a live session, so spending continues under the caps.
  it('does not close the gate for a stale balance, but flags it', () => {
    const b = budgetDisplay({ ...BASE, billingStatus: 'stale' });
    expect(b.gateClosedByBilling).toBe(false);
    expect(b.balanceStale).toBe(true);
    expect(b.maxRunCostUsd).toBeGreaterThan(0);
  });

  it('still closes the gate for the compromise signals', () => {
    for (const s of ['anomaly', 'phantom']) {
      const b = budgetDisplay({ ...BASE, billingStatus: s });
      expect(b.gateClosedByBilling).toBe(true);
      expect(b.maxRunCostUsd).toBe(0);
      expect(b.balanceStale).toBe(false);
    }
  });
});

describe('budgetDisplay — an unread balance is not an empty one', () => {
  // The worker falls back to the daily cap when no lifecycle snapshot exists
  // and keeps running. Reporting 0 here printed "next run allows up to $0.00 /
  // binding constraint: zero" on the panel while deep-dives were being scored
  // at $0.20 each — the dashboard contradicting the system it describes.
  it('falls back to the daily cap rather than claiming zero', () => {
    const b = budgetDisplay({ ...BASE, keyRemainingUsd: null });
    expect(b.balanceUnknown).toBe(true);
    expect(b.maxRunCostUsd).toBeGreaterThan(0);
    expect(b.bindingConstraint).not.toBe('zero');
  });

  it('a known balance is unaffected', () => {
    const b = budgetDisplay({ ...BASE, keyRemainingUsd: 10 });
    expect(b.balanceUnknown).toBe(false);
    expect(b.spendableKeyUsd).toBe(7); // 10 - 3 reserve
  });

  it('an unread balance still respects the daily cap', () => {
    const b = budgetDisplay({ ...BASE, keyRemainingUsd: null, spentTrailing24hUsd: 5 });
    expect(b.remainingTodayUsd).toBe(0);
    expect(b.maxRunCostUsd).toBe(0);
  });
});
