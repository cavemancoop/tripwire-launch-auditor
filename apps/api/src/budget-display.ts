/**
 * M8 dashboard — a read-only display of the live deep-dive budget gate.
 * Duplicated from `apps/worker/src/metabolism/budget.ts`'s `deepdiveRunGate`
 * (apps can't import each other's `src/`; this is the same treatment as
 * `merkle.ts`'s duplicated `verifyProof`). Keep in sync if the gate's formula
 * changes — it is deliberately ~10 stable lines, not a shared package.
 *
 * Caveat surfaced to the dashboard, not hidden: the real gate sums local
 * spend "since 00:00 UTC"; this display uses the estimator's trailing-24h
 * window instead (the only aggregate the API already reads). Same kind of
 * number, different window — labelled as such, never presented as identical.
 */
export interface BudgetDisplayInputs {
  dailyCapUsd: number;
  capPerRunUsd: number;
  /** larger of local-estimate and provider-delta spend over the trailing 24h */
  spentTrailing24hUsd: number;
  /** key remaining, or the account balance when no key is active yet */
  keyRemainingUsd: number;
  reserveUsd: number;
  billingStatus?: string | null;
}

export interface BudgetDisplay {
  dailyCapUsd: number;
  capPerRunUsd: number;
  spentTrailing24hUsd: number;
  remainingTodayUsd: number;
  spendableKeyUsd: number;
  maxRunCostUsd: number;
  /** whichever of the three candidates the min() actually picked */
  bindingConstraint: 'cap_per_run' | 'daily_cap' | 'spendable_key' | 'zero';
  gateClosedByBilling: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function budgetDisplay(i: BudgetDisplayInputs): BudgetDisplay {
  const gateClosedByBilling = i.billingStatus === 'anomaly' || i.billingStatus === 'phantom';
  const remainingTodayUsd = round2(Math.max(0, i.dailyCapUsd - i.spentTrailing24hUsd));
  const spendableKeyUsd = round2(Math.max(0, i.keyRemainingUsd - i.reserveUsd));

  const candidates: Array<[BudgetDisplay['bindingConstraint'], number]> = [
    ['cap_per_run', Math.max(0, i.capPerRunUsd)],
    ['daily_cap', remainingTodayUsd],
    ['spendable_key', spendableKeyUsd],
  ];
  let binding = candidates[0]!;
  for (const c of candidates) if (c[1] < binding[1]) binding = c;

  const maxRunCostUsd = gateClosedByBilling ? 0 : round2(Math.max(0, binding[1]));
  const bindingConstraint: BudgetDisplay['bindingConstraint'] =
    gateClosedByBilling || maxRunCostUsd === 0 ? 'zero' : binding[0];

  return {
    dailyCapUsd: round2(i.dailyCapUsd),
    capPerRunUsd: round2(i.capPerRunUsd),
    spentTrailing24hUsd: round2(i.spentTrailing24hUsd),
    remainingTodayUsd,
    spendableKeyUsd,
    maxRunCostUsd,
    bindingConstraint,
    gateClosedByBilling,
  };
}
