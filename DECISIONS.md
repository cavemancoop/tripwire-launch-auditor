# Decisions

Standing choices that aren't obvious from the code. Newest first.

## Checkpoint after M3 — Fable's calls on the mid-build review (2026-09-05)

Full memo: `checkpoint-decisions-m4.md`. Mid-build review: `midbuild-review-m0-m3.md`.
Both at repo root. Nothing here reopens M0–M3.

- **Data layer:** RPC + ScanHood + our own log reconstruction. No Blockscout at
  runtime (Cloudflare 403); its URLs are human-readable evidence only. M4 adds a
  `packages/rpc-budget` global token bucket + priority queue (watcher > commit >
  outcomes > deepdive > backfill) + response cache, and one `AddressHistoryProvider`
  interface (RPC-logs impl now, indexer later). Probe + use the RPC's real
  `eth_getLogs` range limit.
- **Launchpad attribution:** confirm Pons + LONG by **runtime code hash**
  (`keccak256(eth_getCode(token))`; launchpad tokens share a template), factory
  address second. $ORBIO is the Pons specimen. Blocks the backfill, not M4 code.
  `lp_locked_by_construction` = true only after on-chain custody verification of
  one real position; unverified stays `unknown` and keeps being scored for
  SELL/LIQ (conservative).
- **Freshness gate:** widen 1h → 24h token age at pool creation; store
  `token_age_at_pool_sec`. Tokenized stocks (code older than 24h at pool
  creation) are treated as the quote side; use ScanHood `rwa`.
- **`det_v0` priors:** run a 3-day partial backfill → observed base rates → set
  intercepts to `logit(base rate)`, keep hand-set weight directions → version as
  **`det_v0.1`**, commit the new weights hash. Poor coverage (>70% null) outputs
  the base rate with `confidence: low`, not the logistic's null-vector guess.
  Existing `det_v0` reports stay as posted.
- **`sell_impact_bps`:** RPC-only. Spot price from a tiny Quoter quote, then quote
  sells sized to **100 and 1,000 USDG**; store `sell_impact_bps_100` /
  `sell_impact_bps_1000`. ScanHood `priceUsd` is corroboration only.
- **Cluster rule 4:** ship disabled; keep the `FirstInboundLookup` interface.
- **Backfill scope:** 14 days, not 45. Print a call-count estimate before running;
  enforce `--max-calls`.
- **RevenueSplitter contract:** deferred / not built. The 2% → ZachXBT is a
  periodic **manual transfer** from `REVENUE_ADDRESS`, logged publicly
  (spec §0.1 — minimise money-handling surface). Supersedes the section below.

Rewritten M4 build prompt and M6 tool list are in `checkpoint-decisions-m4.md`
§C / §D. Order of operations: (1) Cooper does Pons+LONG attribution in a browser,
(2) M4 code + a 3-day pass, (3) choose `det_v0.1` intercepts, (4) 14-day backfill
in the background while M5 starts.

## Revenue split — 2% of gross to ZachXBT, in perpetuity (2026-09-05)

> **Superseded 2026-09-05 by the checkpoint above:** no splitter contract. The
> 2% is a periodic manual transfer from `REVENUE_ADDRESS`, logged publicly. The
> percentage, recipient and rationale below still stand.

A fixed **2.00% (200 bps)** of gross USDG revenue routes to
**`0x6eA158145907a1fAc74016087611913A96d96624`** (ZachXBT's public donation
address, for now) as a no-strings thank-you. The rest goes to the operator's
plain `REVENUE_ADDRESS`.

**Mechanism (build in M7):** a small `RevenueSplitter` contract on chain 4663 is
the x402 payee, so every paid call splits at receipt — on-chain and publicly
verifiable, no keeper, no discretion. Prefer a pull pattern (`release(token)`)
or immediate forward; USDG only. Not a treasury router — no token buys, no
schedule (those were cut in spec §11). The split % and recipient are contract
constructor args / immutables; changing them = deploy a new splitter and
re-point `REVENUE_ADDRESS` / the x402 payee.

Config: `.env` `REVENUE_SPLITTER_ADDRESS`, `SPLIT_ZACHXBT_BPS`,
`SPLIT_ZACHXBT_ADDRESS`.

Rationale: the v0.4 Trace layer (spec §10.1) is modelled on ZachXBT's fund-tracing
work; this is an explicit, transparent acknowledgement rather than just a credit
line. He is not involved in or endorsing the project.

---

## Final-stretch autonomy rule (2026-09-12, Fable)

**Standing until submission.** The main drag on the last 48 hours is round-trips:
stopping to ask about things that are reversible anyway.

**Decide alone and record the choice** — anything versioned and reversible:
model slugs, thresholds, notional sizes, window lengths, tolerances, copy and
wording, which cells are excluded, retry and timeout values. Write what was
chosen and why into `CHANGELOG.md` or here; do not open a question for it.

**Ask** — and only these:
- credentials (never create Orbio keys by hand; see below)
- money: anything that spends, transfers or commits funds
- on-chain irreversibles: a tx that cannot be undone or re-posted
- anything that changes **what the project claims** — outcome definitions, the
  wording of a public claim, what counts as a track record

**Batch questions into one message per session**, not one per step.

### Corollary: stop minting Orbio keys manually
`orbio_create_key` mints *and retires* in the same call, so a hand-made key
silently kills whichever key the agent is currently using. The agent provisions
its own key on start; leave it alone. `ORBIO_API_KEY` in `.env` is a fallback
seed only and goes stale the moment the agent mints.

---

## M5c — billing basis, epoch reconciliation, and what actually revokes (2026-09-12)

**The near-failure.** Five live deep-dives, five validator-passed reports, zero
ledger rows: the Orbio gateway 404s OpenRouter's `GET /generation` and returns
OpenAI-shaped usage with no cost field. The IDS reconciler compared an empty
ledger with the provider's growing spend and would have revoked the agent's own
key at the $0.01 default tolerance — during the overnight unattended run.

**The design error** (external review, adopted in full): one `spend` number was
doing three jobs. They are now three things:

| job | source | field |
|---|---|---|
| what Orbio actually charged | `orbio_get_balance.spent.usd`, polled every tick | `MetabolismEpoch.providerDeltaUsd` |
| which report caused it | tokens × pinned price, then reconciled per epoch | `MetabolismSpend.costUsd` + `costBasis` |
| is the agent safe to run | three independent controls, below | `LifecycleLog.billingStatus` |

**No cost figure exists without its provenance.** `costBasis` ∈
`provider_reported | provider_generation | token_estimate | provider_reconciled_estimate | unavailable`.
An unpriced model or missing token counts records `unavailable` with cost 0 —
never a plausible-looking number. `pricingVersion` is stored on every estimate.

**Epoch reconciliation.** Each 60s lifecycle tick is an epoch: the provider's
spend delta over the window vs the sum of local estimates recorded in it. The
ratio (`reconciliationFactor`) is applied back to those rows, which become
`provider_reconciled_estimate`. The signed discrepancy is **the agent's own
cost-forecast error**, exposed on `GET /v1/lifecycle` as `estimator` — the
metabolism is a forecaster graded against reality, under the same thesis as
everything else in the project.

**Three controls, and what each does:**
1. **Hard provider budget** — the daily cap is checked against
   `max(local estimate, Σ provider deltas today)`. Gate closes; key untouched.
2. **Estimator anomaly** — |discrepancy| > `METABOLISM_ANOMALY_PCT` (50%) for
   `METABOLISM_ANOMALY_EPOCHS` (3) consecutive windows → `billingStatus =
   anomaly` → inference paused + logged. Never revokes. A bad estimate is not a
   bad key.
3. **`PHANTOM_SPEND`** — provider spend rose while the agent made zero calls
   (above `METABOLISM_PHANTOM_TOLERANCE_USD`). This is the only condition that
   means someone else holds the key. Revoke → NO_KEY → halt until
   `pnpm orbio:auth`. Named as its own lifecycle event.

`IDS_MISMATCH` is retired from the runner (kept in `state.ts` so historical rows
replay). `METABOLISM_IDS_TOLERANCE_USD` is back at 0.01 and advisory. The $100
stopgap is gone.

**M6 acceptance criterion, rewritten.** "Cost appears in the ledger" tested an
implementation detail the gateway does not expose. The criterion is now:
*after controlled inference, authoritative provider spend increases; local
aggregate spend reconciles to the provider total within the anomaly band; and
every displayed per-report cost declares its attribution basis.*

**Why not the serialized balance-delta probe** (mutex one deep-dive at a time,
read the meter before and after): it gives exact per-request cost at 10–15
runs/day and is the wrong shape for a query-driven product at dozens-to-hundreds
of evaluations/day. Reconcile windows, not requests.

### Roadmap — designed, not built this week

- **Progressive analysis tiers.** Cheap deterministic checks → cheap model
  triage → deep dive only if "is there enough here to justify investigating?"
  (not "is this token good"). Preserves finding things before they are obvious;
  makes 15/day and 5,000/day the same architecture.
- **Deduplicated launch state.** Cache key `token_address + analysis_version +
  evidence_timestamp`. Eighty queries about one token over three hours is one
  deep dive plus cheap refreshes; a material event (creator sells, LP moves,
  volume regime change) invalidates the relevant part and re-runs. The unit of
  intelligence becomes the evolving launch, not the chat request — likely the
  largest economic win available.
- **Local velocity control.** Estimated $/min and requests/min as a fast
  circuit-breaker ahead of the provider's accounting.
- **Upstream ask to Orbio.** They hold model, tokens, cost and timing per
  request server-side. Either response headers (`x-orbio-request-id`,
  `x-orbio-cost-usd`, `x-orbio-input-tokens`, `x-orbio-output-tokens`) or an
  `orbio_get_usage(since)` MCP method would make `provider_reported` the default
  basis and retire estimation entirely.

## M9 follow-up — the staleness gate now spends, and why (2026-09-14)

**Decision.** A lapsed Orbio MCP session no longer stops inference. Previously
`billingStatus: 'stale'` closed the deep-dive gate entirely — "refusing to spend
unwatched." It now allows the run, falls back to the last known balance (or the
daily cap when none has ever been read), and reports the staleness instead.
`phantom` and `anomaly` still close the gate; those are compromise signals, not
absence of news.

**Why.** Measured 2026-09-14: a gateway key keeps billing inference normally
with an OAuth session that expired two days earlier. The session bounds *key
management* — create, revoke, read balance through the MCP — not spending. The
old policy conflated the two, and the cost was total: `llm_deepdive_v0`, the
forecaster the entire benchmark exists to grade, had never run in production at
all. The guards that actually bound spend don't need Orbio reachable: the $5
daily cap, the $0.20 per-run cap, our own per-request ledger, and a gateway that
fails safe on an empty balance.

**What this costs.** We may spend up to the daily cap against a balance figure
that is hours old, or that has never been read. Bounded and visible: the panel
prints `balance last confirmed Nh ago` (`balanceStale`) or says it has never
been read (`balanceUnknown`), and the spend figures carry a `basis`
(`epoch_reconciled` | `local_ledger` | `none`) so a local estimate is never
presented as a provider-confirmed number.

**Not derivable from a flag.** This is a deliberate loosening of an M5c safety
rule, not an implementation detail — recorded here so it is read as a decision
rather than inferred from a field on the dashboard.

**Consequence for spec §0.1 property 2.** Balance reads still require the
session: probed exhaustively on 2026-09-14, the Orbio gateway exposes no key,
usage, credits, balance or account endpoint (every path returns the same HTML
catch-all; `/api/v1/models` returns real JSON, so GETs work — those routes
simply don't exist). `/api/key` returns 405 rather than 404, i.e. the route
exists but rejects GET — almost certainly the POST behind `orbio_create_key`,
deliberately not probed because that call mints *and retires* the active key.
So credit accrual can only be derived while a session is up, and property 2 is
demonstrable during the session window rather than continuously. The panel must
say which.
