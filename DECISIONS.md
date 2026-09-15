# Decisions

Standing choices that aren't obvious from the code. Newest first.

## Outcome resolver: backoff, give-up, fair share across labels (2026-09-15)

Triage item 1 (#3). The live loop swept the 25 oldest horizon-due rows every
minute; 24 of them were SELL_IMPAIRED@1h rows failing an eth_call at the horizon
block, deferred, and re-picked the next minute. ~1 outcome resolved per minute,
so nine of eleven cells never reached the benchmark.

Chosen (operational, reversible; the committed outcome rule is unchanged):
- **Backoff:** a deferred row is not picked again for 30 min.
- **Give-up:** still failing on a transient error 24h after its *first*
  deferral -> `UNRESOLVABLE` with the reason. OUTCOME_RULES_v1 already says a
  failed measurement is unresolvable, never an outcome; UNRESOLVABLE rows are not
  scored. Clock runs from first deferral, not horizon, so backfill rows with
  long-past horizons are not dropped on their first error.
- **Fair share:** the live loop takes oldest-first *within* each label and
  round-robins across labels. SELL_IMPAIRED is descriptive-only; it no longer
  gets to starve the four scoreable outcomes.
- Code-path failures (non-transient) also back off but are never given up on,
  so a fix can still resolve them.
- The raw RPC message behind a "network" quote error is now logged
  (`rpcError`): unrecognised errors default to "network" and were retried
  blind. Classification is unchanged.
- `/metrics` gains per-label `outcomes_pending_due`, `outcomes_deferred`,
  `outcomes_resolved_24h`, so a starved cell is visible without log access.

**Measured after deploy, same day:** the head-of-line block was real but small
(24 retrying rows); the larger limit is throughput. Horizon-due backlog was
~21.6k rows (INSIDER_EXIT 9.5k, SELL_IMPAIRED 9.0k, the three 24h-only labels
1.0k each) against ~900 resolved/24h. With backoff + fair share: 16-20 resolved
per sweep, ~3.5/min, LIQ_IMPAIRED and TRADING_ALIVE +11 each in 15 min (vs 4 in
the prior 24h). One sweep took ~5 min at concurrency 1, so the live loop now
resolves 4 in parallel (`OUTCOMES_CONCURRENCY`); the shared RPC bucket still
caps total calls with watcher and commit ahead of outcomes.

Not claimed: that the nine cells fill this week. They are now reachable; how fast
depends on how many due rows each label has and what the rpcError turns out to be.

## Codex review triage (2026-09-15)

Both phases are in `docs/review-pack/CODEX-REVIEW-2026-09-15.md` (A) and
`…-PHASE-B.md` (B). Rule applied: anything that touches a public claim is fixed
before judging (20 Sep); everything else is deferred with a date. Numbers refer
to Phase B's revised top ten; letters to its §3 "unanticipated" list and the
prior-critique rows it called "only relabeled".

**A builder's finding Codex could not see (worker logs):** the outcome resolver
is head-of-line blocked. It sweeps 25 due rows a minute, oldest horizon first,
and 24 of the 25 are the same SELL_IMPAIRED@1h rows that fail on an RPC error
at the horizon block, get deferred, and are picked again next minute.
Throughput ≈ 1 resolved outcome/min. That, not elapsed time, is why nine of
eleven cells have no data (#3) — and it makes #3 fixable this week.

| Finding | Verdict | One line |
|---|---|---|
| #1 Orbio story absent from production | **Accept** | Run the built session push daily; wire property 2 with `basis`; when the log is empty the panel must say so, not lead. Before judging. |
| #2 `det_v0` miscalibrated (BSS −12.8 / −9.1) | **Accept** | The fix was decided at the post-M3 checkpoint and never applied: `det_v0.1` = intercepts at logit(observed base rate), weights unchanged, versioned and hash-committed; `det_v0`'s record stays as posted. Before judging — the probabilities are public. |
| #3 two-cell benchmark | **Accept** (root cause above) | Back off deferred rows and spread sweeps across cells; expose per-cell pending/deferred/unresolvable counts on `/v1/benchmark`. Before judging. |
| #4 API can't reproduce the benchmark | **Accept, partly** | Read-only `GET /v1/launch/:token` with primary-pool evidence, feature vector + provenance, outcome rows. Before judging if time after #1–#3; a snapshot dataset export is deferred to post-judging (30 Sep). |
| #5 fail-closed observability | **Accept** | Already item 3 on the list: per-catch-site counters + oldest-failure age on `/metrics`, alert on threshold. Fail-closed report generation on pool-selection failure. Before judging. |
| #6 coverage/latency claims exceed measurement | **Accept** | Replace "every launch" / "within seconds" with measured coverage over eligible launches (age ≥ T+10m) and p50/p95 report latency on `/metrics` and in copy. Committed-coverage gauge replaces commit age as the alert. Before judging. Persisting the held tx across restart: deferred (30 Sep). |
| #7 dashboard certainty exceeds data | **Accept** | `$0.00` literals → `n/a` unless derived; "P&L" → "compute cost, trailing 24h"; empty chain renders "no rows", never "verified: yes"; `balanceUnknown` shown in the budget card. Before judging. |
| #8 baseline methodology | **Accept, partly** | Publish overlap n per comparison and add a fixed-window climatology baseline as a named forecaster (`base_rate_fixed`) — the rolling one's AUROC < 0.5 needs explaining before judging, not after. Bootstrap CIs and decision utility: deferred (post-judging). |
| #9 unauthenticated deep-dive endpoints | **Accept — needs Cooper's yes** | Require `x-api-key` on `POST /v1/deepdive` and MCP `request_deepdive`; `/v1/assess` stays free (no spend). Changes a public endpoint, so it is a human checkpoint. |
| #10 narrative inconsistent, demand-free | **Accept (copy) / Defer (demand)** | "four" vs "five" outcomes, "authorize once", "paid entirely", "track record is the product" corrected in README, summary and DEMO.md (M10). Demand commitments were always post-contest (spec §10); no change. |
| §3.7 Telegram "never double-posts" | **Accept** | README wording → "best-effort deduplicated (mark-after-send)". |
| §3.8 `pnpm verify` green with forge skipped | **Accept** | The summary line must say "contract tests NOT run" when forge is absent; README stops claiming full coverage. |
| T1 / F9 (demand, griefing) | as #10 / #9 | — |
| T4 economics "only relabeled" | **Accept (copy)** | As #7. The v0.1 spreadsheet is marked superseded in the planning dir; no replacement model this week. |
| T16 growth projections | **Accept (withdraw)** | Same: mark superseded; nothing is published that depends on it. |
| F3 sybil deployers | **Reject for now** | Disclosure is the honest state; entity resolution is v0.4 Trace. |
| F5 outcome manipulation of the 24h max | **Defer (post-judging)** | Changing an outcome rule mid-record is a human checkpoint and resets the cell; revisit with the SELL_IMPAIRED resize. |
| B5 velocity control, B8 tiers | **Defer (post-judging)** | Roadmap as recorded under M5c. |
| B10 upstream ask to Orbio | **Accept** | Send it (builders channel) — a human action, this week. |
| Closer plan §2.3 "four days clears the bar" | **Withdrawn** | Codex is right: positives, not days, gate INSIDER_EXIT (26/30), and starved cells don't fill with time. |

### Ordered remaining work (replaces HANDOFF-2026-09-15 §3)

1. Resolver backoff + spread (#3) — the cheapest, largest change to the public record.
2. `det_v0.1` intercepts, committed (#2).
3. Dashboard honesty pass (#7, §3.7, §3.8) + copy pass (#6, #10 wording).
4. Coverage/latency gauges and alert (#6); failure counters (#5).
5. Session push run + property 2 with provenance (#1).
6. `/v1/launch/:token` detail (#4); `base_rate_fixed` + overlap n (#8).
7. **Needs Cooper:** #9 auth on deep-dive; B10 message to Orbio; daily `pnpm orbio:auth && pnpm railway:push-env --with-session`; `TELEGRAM_ALERTS_CHANNEL_ID`.
8. M10: DEMO.md, summary, licence, public repo — last, after 1–6 so it describes what is true.

Post-judging (dated 30 Sep): backfill import as `retrospective=true`; SELL_IMPAIRED resize;
F5; B5/B8; snapshot export; bootstrap CIs; held-tx persistence.

## Item 4 — an Orbio session on Railway, and what it may do there (2026-09-15)

**Built, not yet run.** `pnpm railway:push-env --with-session` exists; whether to
use it is the operator's call, because of the cost below.

**The cost, stated plainly.** The token store is a stronger secret than the
gateway key — the key only spends against a capped balance; the session can
mint and revoke keys through the MCP. The seed is encrypted with
`TOKEN_ENCRYPTION_KEY`, which is already on Railway, so both halves sit in one
place. Anyone who can read the worker's env holds a working Orbio session.

**What bounds it.**
- **No refresh token in the seed.** Stripped on the laptop and again at boot.
  The pushed session dies with its access token (~1h) and nobody holding the
  Railway env can extend it. It also cannot race or burn the laptop's one-shot
  refresh grant.
- **No gateway key in the seed.** A container disk is ephemeral and the store
  outranks `ORBIO_API_KEY`, so a seeded key would come back on every restart and
  shadow any newer key pushed later. The key travels only as `ORBIO_API_KEY`.
- **Observe mode (`METABOLISM_KEY_MANAGEMENT=observe`, implied by a seed).** The
  deployed lifecycle loop reads balance and key status and writes signed
  snapshots — which is all property 2 needs — but turns every mint, rotate and
  revoke into a logged `would …` snapshot. A pending mint with the operator's key
  already live is recorded as adopting that key. Without this, the prod loop
  (which starts at `NO_KEY` with an empty lifecycle log) would have minted on its
  first tick, retiring the key both the laptop and `ORBIO_API_KEY` hold, and the
  new key would have lived only on an ephemeral disk.
- **Seed never clobbers.** Written only when no store file exists.

**What observe mode gives up.** A `PHANTOM_SPEND` on Railway is not revoked. It
still closes the deep-dive gate (`billingStatus = phantom`) and logs an error;
revocation stays a laptop action (`pnpm orbio:auth`, then the managed loop).
Key management is demonstrated locally, not in production.

**Net effect on the claim.** Production can show balance-derived metabolism for
about an hour after each push, and the panel must say that window exists — the
same bound recorded under M9 follow-up, now reachable instead of 100% null.

## Commit loop, corrected the same day: null RPC answers were being cached (2026-09-15, later)

The fix above made things worse. Root cause of the receipt timeouts, found only
after Codex's Phase A review showed 0/200 recent launches committed: the
`rpc-budget` response cache treats every hash-addressed read as immutable and
was caching `null` — the first receipt poll that hit a lagging node behind
Chainstack's load balancer got "not found", and every later poll for the whole
240 s deadline was served that null from cache. Holding the batch and re-polling
for 30 minutes therefore re-polled the same cached null, so each slow receipt
stalled commits for ~34 minutes instead of ~4. Between the 05:27 and ~08:00 UTC
deploys, batches landed every ~35 minutes against ~18k reports/day, and the
200-leaf oldest-first batches never reached recent launches.

Now: a `null` result is never cached (a real answer still is, once it exists),
and a held batch no longer blocks the next one — its reports are excluded from
`pending` until it is recorded or dropped. The "resolved before any new batch is
sent" wording above is superseded.

## Commit loop — a sent tx is resolved before another is sent (2026-09-15)

The public feed posted `commit lag: 10min` at 21:18 local. Cause: four
`commitBatch` txs in the recent log hit the 240s receipt deadline; all four had
**mined successfully** (checked by hash). With no DB row written, their reports
stayed uncommitted and were re-anchored by the next batch — orphan roots
on-chain, extra gas, and proofs that point at a later commit than the one that
actually came first. Launch volume is ~3× last week (8,964/24h) and outcome
resolution was logging RPC network errors at the same time, so the shared RPC
budget is the likely reason receipts are slow; that part is unconfirmed.

Now: a timed-out tx is held as *unconfirmed* and checked every tick before any
new batch goes out — late success records that batch, a revert or 30 minutes
with no receipt drops it and lets its reports re-commit. Held in memory; a
restart falls back to the old behaviour. Earlier orphan roots are left as they
are (on-chain, harmless to verification — every report still has a valid proof
under the root recorded for it).

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
