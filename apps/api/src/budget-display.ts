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
  /** key remaining, or the account balance when no key is active yet.
   *  `null` = never read (no lifecycle snapshot) — mirror the worker, which
   *  falls back to the daily cap and keeps running rather than treating an
   *  unread balance as an empty one. */
  keyRemainingUsd: number | null;
  reserveUsd: number;
  billingStatus?: string | null;
  /** property 2 (2026-09-16): 50% of CREDIT activated into the agent's account
   *  in the trailing 24h (apps/worker/src/metabolism/budget.ts's
   *  dailyDeepdiveBudget, mirrored here). Undefined when the worker isn't
   *  configured to compute it — the display then behaves exactly as before
   *  (flat dailyCapUsd only), never a new way to show zero. */
  creditShareUsd?: number;
}

export interface BudgetDisplay {
  dailyCapUsd: number;
  capPerRunUsd: number;
  spentTrailing24hUsd: number;
  remainingTodayUsd: number;
  spendableKeyUsd: number;
  maxRunCostUsd: number;
  /** whichever candidate the min() actually picked */
  bindingConstraint: 'cap_per_run' | 'daily_cap' | 'credit_share' | 'spendable_key' | 'zero';
  /** echoed only when creditShareUsd was provided */
  creditShareUsd?: number;
  gateClosedByBilling: boolean;
  /** the balance behind these numbers has not been re-read from Orbio recently */
  balanceStale: boolean;
  /** no balance has ever been read — the figures fall back to the daily cap */
  balanceUnknown: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function budgetDisplay(i: BudgetDisplayInputs): BudgetDisplay {
  // Mirrors deepdiveRunGate: only the compromise signals close the gate.
  // `stale` means the Orbio session lapsed so nobody has re-read the balance —
  // spending continues (the gateway key bills fine without a live session) and
  // the staleness is reported as a fact instead.
  const gateClosedByBilling = i.billingStatus === 'anomaly' || i.billingStatus === 'phantom';
  const balanceStale = i.billingStatus === 'stale';
  const remainingTodayUsd = round2(Math.max(0, i.dailyCapUsd - i.spentTrailing24hUsd));
  // Matches apps/worker/src/deepdive/run.ts's defaultLoadBudget: with no
  // balance reading the worker treats the daily cap as the spendable figure.
  const known = i.keyRemainingUsd;
  const balanceUnknown = known === null;
  const spendableKeyUsd =
    known === null ? remainingTodayUsd : round2(Math.max(0, known - i.reserveUsd));

  const candidates: Array<[BudgetDisplay['bindingConstraint'], number]> = [
    ['cap_per_run', Math.max(0, i.capPerRunUsd)],
    ['daily_cap', remainingTodayUsd],
    ['spendable_key', spendableKeyUsd],
  ];
  if (i.creditShareUsd !== undefined) {
    // remaining-today already accounts for what's spent, credit_share hasn't
    // been spent against yet today — the same asymmetry dailyDeepdiveBudget has.
    candidates.push(['credit_share', Math.max(0, i.creditShareUsd)]);
  }
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
    balanceStale,
    balanceUnknown,
    ...(i.creditShareUsd !== undefined ? { creditShareUsd: round2(i.creditShareUsd) } : {}),
  };
}
