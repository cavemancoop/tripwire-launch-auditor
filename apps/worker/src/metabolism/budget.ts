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
  /** Σ MetabolismSpend.costUsd since 00:00 UTC (local, estimated) */
  todaySpendUsd: number;
  /** M5c: Σ MetabolismEpoch.providerDeltaUsd since 00:00 UTC (authoritative).
   *  The daily cap is checked against the larger of the two. */
  providerSpendTodayUsd?: number;
  /** orbio_get_balance.balance.usd − RESERVE_USD */
  spendableUsd: number;
  /** M5c: the latest lifecycle billing state — `anomaly` / `phantom` close the gate */
  billingStatus?: string | null;
}

export interface DeepdiveRunGate {
  allowed: boolean;
  reason: string;
  remainingTodayUsd: number;
  maxRunCostUsd: number;
  /** the balance this decision used has not been re-read from Orbio recently —
   *  the run is still allowed, but the figure behind it is old. Display it. */
  balanceStale: boolean;
}

export function deepdiveRunGate(i: DeepdiveRunGateInputs): DeepdiveRunGate {
  // the daily cap is a hard budget: trust whichever figure is larger
  const spentTodayUsd = Math.max(i.todaySpendUsd, i.providerSpendTodayUsd ?? 0);
  const remainingTodayUsd = round2(Math.max(0, i.dailyCapUsd - spentTodayUsd));
  const maxRunCostUsd = round2(Math.max(0, Math.min(i.capPerRunUsd, remainingTodayUsd, i.spendableUsd)));
  const balanceStale = i.billingStatus === 'stale';
  // `phantom` and `anomaly` are compromise signals — the provider charged for
  // work we didn't do, or the bill and our estimate disagree beyond the band.
  // Those still stop inference.
  //
  // `stale` is not a compromise signal: it only means the Orbio MCP session
  // lapsed, so nobody has re-read the balance recently. Measured 2026-09-14:
  // a gateway key keeps billing inference normally with a two-day-dead OAuth
  // session, so the session bounds *key management*, not spending. Blocking on
  // it meant `llm_deepdive_v0` never ran in production at all — the forecaster
  // the whole benchmark exists to grade. The real guards are the ones below:
  // the daily cap, the per-run cap, and our own spend ledger, none of which
  // need Orbio to be reachable. A genuinely empty balance fails safe at the
  // gateway. Staleness is surfaced instead (`balanceStale`) so the dashboard
  // can print how old the figure is rather than silently trusting it.
  if (i.billingStatus === 'phantom' || i.billingStatus === 'anomaly') {
    return {
      allowed: false,
      reason: `billing ${i.billingStatus} — inference paused until the lifecycle runner clears it`,
      remainingTodayUsd,
      maxRunCostUsd: 0,
      balanceStale,
    };
  }
  if (i.spendableUsd <= 0) {
    return { allowed: false, reason: `balance is at or below the reserve (spendable $${round2(i.spendableUsd)})`, remainingTodayUsd, maxRunCostUsd, balanceStale };
  }
  if (remainingTodayUsd <= 0) {
    return { allowed: false, reason: `daily cap $${round2(i.dailyCapUsd)} reached (spent $${round2(spentTodayUsd)})`, remainingTodayUsd, maxRunCostUsd, balanceStale };
  }
  if (maxRunCostUsd <= 0) {
    return { allowed: false, reason: 'nothing affordable this run', remainingTodayUsd, maxRunCostUsd, balanceStale };
  }
  return {
    allowed: true,
    reason: balanceStale
      ? `ok — up to $${maxRunCostUsd} this run (balance figure is stale; capped by the daily limit and the local ledger)`
      : `ok — up to $${maxRunCostUsd} this run`,
    remainingTodayUsd,
    maxRunCostUsd,
    balanceStale,
  };
}

/** Days since the last manual credential action (spec §8 headline metric). */
export function daysUnattended(lastManualActionAt: Date | null, now: Date = new Date()): number {
  if (!lastManualActionAt) return 0;
  return Math.max(0, (now.getTime() - lastManualActionAt.getTime()) / 86_400_000);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
