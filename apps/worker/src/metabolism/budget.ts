/**
 * Deep-dive budget policy (spec §8): the daily budget for `llm_deepdive_v0` is
 *
 *   min( dailyCapUsd, 50% of credits accrued in the trailing 24h, keyRemaining − reserve )
 *
 * so throughput visibly follows token activity and the agent never holds or
 * converts money to make that happen (spec §0.1 property 2).
 */
export interface BudgetInputs {
  /** DEEPDIVE_DAILY_CAP_USD */
  dailyCapUsd: number;
  /** credits accrued in the trailing 24h (from orbio_get_key_status history) */
  trailingCreditsUsd: number;
  /** current key balance remaining */
  keyRemainingUsd: number;
  /** reserve to hold back = reserveR * claimSizeUsd */
  reserveUsd: number;
}

export interface BudgetBreakdown {
  budgetUsd: number;
  bindingConstraint: 'daily_cap' | 'credit_share' | 'key_reserve' | 'zero';
  creditShareUsd: number;
  spendableKeyUsd: number;
}

export function reserveUsd(reserveR: number, claimSizeUsd: number): number {
  return Math.max(0, reserveR) * Math.max(0, claimSizeUsd);
}

export function dailyDeepdiveBudget(i: BudgetInputs): BudgetBreakdown {
  const creditShareUsd = Math.max(0, 0.5 * i.trailingCreditsUsd);
  const spendableKeyUsd = Math.max(0, i.keyRemainingUsd - i.reserveUsd);

  const candidates: Array<[BudgetBreakdown['bindingConstraint'], number]> = [
    ['daily_cap', Math.max(0, i.dailyCapUsd)],
    ['credit_share', creditShareUsd],
    ['key_reserve', spendableKeyUsd],
  ];
  let binding = candidates[0]!;
  for (const c of candidates) if (c[1] < binding[1]) binding = c;

  const budgetUsd = Math.max(0, binding[1]);
  return {
    budgetUsd: round2(budgetUsd),
    bindingConstraint: budgetUsd === 0 ? 'zero' : binding[0],
    creditShareUsd: round2(creditShareUsd),
    spendableKeyUsd: round2(spendableKeyUsd),
  };
}

/** How many deep-dive runs today's budget affords at the per-run cap. */
export function runsAffordable(budgetUsd: number, capPerRunUsd: number): number {
  if (capPerRunUsd <= 0) return 0;
  return Math.floor(budgetUsd / capPerRunUsd);
}

/**
 * M6 — the hard per-run gate checked immediately before a deep-dive:
 *  - the run's cap must fit under the remaining daily cap
 *  - the run's cap must fit under the spendable balance (`balance − RESERVE_USD`,
 *    the M5b-2 budget 3rd term)
 * `maxRunCostUsd` is what to pass as `maxCost` to the agent loop.
 */
export interface DeepdiveRunGateInputs {
  capPerRunUsd: number;
  dailyCapUsd: number;
  /** Σ MetabolismSpend.costUsd since 00:00 UTC */
  todaySpendUsd: number;
  /** orbio_get_balance.balance.usd − RESERVE_USD */
  spendableUsd: number;
}

export interface DeepdiveRunGate {
  allowed: boolean;
  reason: string;
  remainingTodayUsd: number;
  maxRunCostUsd: number;
}

export function deepdiveRunGate(i: DeepdiveRunGateInputs): DeepdiveRunGate {
  const remainingTodayUsd = round2(Math.max(0, i.dailyCapUsd - i.todaySpendUsd));
  const maxRunCostUsd = round2(Math.max(0, Math.min(i.capPerRunUsd, remainingTodayUsd, i.spendableUsd)));
  if (i.spendableUsd <= 0) {
    return { allowed: false, reason: `balance is at or below the reserve (spendable $${round2(i.spendableUsd)})`, remainingTodayUsd, maxRunCostUsd };
  }
  if (remainingTodayUsd <= 0) {
    return { allowed: false, reason: `daily cap $${round2(i.dailyCapUsd)} reached (spent $${round2(i.todaySpendUsd)})`, remainingTodayUsd, maxRunCostUsd };
  }
  if (maxRunCostUsd <= 0) {
    return { allowed: false, reason: 'nothing affordable this run', remainingTodayUsd, maxRunCostUsd };
  }
  return { allowed: true, reason: `ok — up to $${maxRunCostUsd} this run`, remainingTodayUsd, maxRunCostUsd };
}

/** Days since the last manual credential action (spec §8 headline metric). */
export function daysUnattended(lastManualActionAt: Date | null, now: Date = new Date()): number {
  if (!lastManualActionAt) return 0;
  return Math.max(0, (now.getTime() - lastManualActionAt.getTime()) / 86_400_000);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
