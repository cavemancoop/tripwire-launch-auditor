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
