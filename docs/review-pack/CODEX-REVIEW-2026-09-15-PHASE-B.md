# Codex independent review — Phase B — 2026-09-15 UTC

Pasted verbatim from the Codex cloud task on `cavemancoop/tripwire-review` @ `1ae2d8f`
(Phase A snapshot + `PRIOR-CRITIQUE.md`, `closer-plan-2026-09-14.md`, and the
post-snapshot commit fix as a diff). Phase A is `CODEX-REVIEW-2026-09-15.md`.
Triage of both phases is in `DECISIONS.md` ("Codex review triage, 2026-09-15").

---

## Scope and method

This is the requested second pass over the two reviews and builder response tables in
`PRIOR-CRITIQUE.md`, the 14 September closer plan, the Phase A findings, the frozen
v0.2 implementation, and the post-snapshot commit fix. I treated each response-table
row as a claim to test, not as evidence that the underlying objection was closed.

I made only the permitted public `GET` requests. I did not call Orbio, `/mcp`, or any
write endpoint. The live captures were made at approximately 08:30 UTC and stored
only in `/tmp`. At that instant, the newest-200 feed contained **143 deterministic
reports and 130 commitments**, versus Phase A's 136 and 0. The benchmark still had
only `INSIDER_EXIT@6h` and `SELL_IMPAIRED@1h`; `det_v0` Brier Skill was **-12.8380**
and **-9.1389**, respectively, and every comparison still had
`claimAllowed:false`. Lifecycle still returned **0 entries**, an unknown balance,
zero reconciliation windows, and local-ledger-only spending.

The 130/200 recovery is strong live evidence that `e3e82f9` fixed the acute outage.
It does **not** prove 100% commitment coverage or erase the architectural issue that
the pending transaction is held only in process memory. It does remove Phase A's
"0/200" incident from first place in the ranked list.

Status vocabulary below is deliberately stricter than the builders' table:

- **Resolved** — the objection was removed or the requested control was actually
  implemented to a level that answers it.
- **Partially resolved** — a material mitigation exists, but the original risk or
  evidentiary gap remains.
- **Only relabeled** — wording, categorization, a roadmap entry, or an acknowledgement
  changed without materially answering the objection. Removing a discarded feature
  is a real resolution, not relabeling.

## 1. Audit of every prior-critique response

### Part 1 — v0.1 red-team

| Item | Verdict | Evidence and assessment |
|---|---|---|
| **T1 — no paid demand / "uncontested" false** | **Only relabeled** | The response concedes that no integration commitment was sought. A future three-partner demand gate and naming competitors do not demonstrate demand. Phase A likewise found no demand evidence and a contest narrative still presenting a product claim. |
| **T2 — ill-defined `P(rug)` and weak Brier target** | **Partially resolved** | Replacing the accusation-like composite with mechanical endpoints and adding Brier Skill, AUROC/AUPRC, ECE, log loss, DeLong significance, n≥200 and ≥30 positives is a substantive methodological repair. It is incomplete because buyer decision utility is absent, only two outcome/horizon cells are public, SELL is unusably prevalent, and live `det_v0` Brier Skill remains catastrophically negative. This is much more than relabeling, but not a solved scoring problem. |
| **T3 — features mismatch launchpad invariants** | **Partially resolved** | The pivot toward insider exit, clusters, and drawdown is real; custody verification before `lp_locked_by_construction` is sensible. But SELL/LIQ becoming N/A or descriptive reduces rather than replaces the lost signal, and the public scorecard still spends one of only two cells on 90.49%-positive SELL. |
| **T4 — "self-funding" relies on unrelated ORBIO volume** | **Only relabeled** | Calling credits a subsidy fixes copy, not economics. The purported two P&Ls do not establish standalone economics: revenue and subsidized cash are hard-coded `$0.00`, and infrastructure, RPC, gas, and labor are absent. Phase A correctly called this a usage-cost panel, not P&L. |
| **T5 — free competitors erase first-mover advantage** | **Partially resolved** | ScanHood and GoPlus are genuine named baselines. However, their public overlap is much smaller than internal coverage, no comparison is claimable, Robinhood Checker/Hood Terminal are absent, and no buyer-relevant superiority is demonstrated. |
| **T6 — no meaningful judging-window track record** | **Partially resolved** | A live record now exists and n is substantial in two cells; withholding retrospective rows preserves provenance. But nine promised cells are absent, LLM has no public score row, INSIDER_EXIT still has only 26 positives, and all claim gates are closed. Building but not importing a backfill does not solve the thin public record. |
| **T7 — Fact Engine/entity resolution exceeds seven-day scope** | **Resolved** | The shipped narrow, direct-evidence cluster is an appropriate scope cut, with the speculative fourth rule disabled. It does not solve entity resolution generally, but it resolves the feasibility objection by no longer claiming to ship the broad engine in v0.2. |
| **T8 — RevenueRouter route underspecified** | **Resolved** | The route and automatic ORBIO purchase were removed. There is no longer a contest-path router whose market route must be assumed. |
| **T9 — predictable treasury swap is MEV bait** | **Resolved** | Removing the automated router removes this attack surface. A manual logged transfer is a different and explicitly human process. |
| **T10 — "no human touch" unverifiable** | **Partially resolved** | Narrowing the metric to time since manual credential action is the right conceptual fix. Production still has zero signed lifecycle rows, while the API reports an empty chain as verified/from genesis, so the replacement is not demonstrated and is presented misleadingly. |
| **T11 — commitments prove integrity, not correctness** | **Partially resolved** | The narrower dashboard sentence and committed code/rule artifacts are material improvements. The feed has recovered to 130 commitments in the latest 200 after the supplied fix. But inputs and outcome evidence are not publicly retrievable, hosted-model execution is not reproduced, and the latest 200 are not universally committed. "Nothing stronger" is also undermined by adjacent absolutes. |
| **T12 — wallet labels are Sybilable/poisonable** | **Partially resolved** | Removing same-funder association and attaching evidence transaction hashes removes the most obvious bridge/CEX poisoning rule. Fresh-wallet evasion remains, confidence is not exposed, and there is no evidence-weighted entity graph. |
| **T13 — launch spam griefs infrastructure** | **Partially resolved** | Two lanes, qualification, creator quota, and RPC prioritization are substantive defenses. They bound costly scanner/deep-dive work, but "every launch" still consumes index/report/commit resources, per-contract pathological work is unbounded, and public paid-work endpoints remain unauthenticated. |
| **T14 — x402 discovery mistaken for demand** | **Resolved** | x402 was removed from distribution and not built; the challenged acquisition premise is no longer part of the contest design. This does not resolve T1's general demand gap. |
| **T15 — facilitator costs omitted** | **Resolved** | No facilitator is used, so the omitted-cost objection is inapplicable to v0.2. |
| **T16 — implausible 40%/50% growth projections** | **Only relabeled** | Ceasing to publish the projections prevents a public overclaim, but the response explicitly says the model was neither corrected nor withdrawn. There is no replacement demand/economic model. |
| **T17 — strong-model escalation loses money** | **Resolved** | The escalation path was removed; one pinned model plus per-run and daily caps answers the specific unit-loss and runaway-spend objection. Whether that model is useful is a separate quality issue. |
| **T18 — legal/perception risk of calling tokens rugs** | **Resolved** | "Rug" was removed from report fields, drawdown is expressly non-accusatory, and identity attribution is not automated. That directly removes the challenged publication behavior. |
| **T19 — Orbio dependency needs real failure testing** | **Partially resolved** | Empirical work did discover nonexistent tool names, one-shot refresh, and missing key/usage APIs, and the design recorded those bounds. But production still has zero lifecycle rows/reconciliation windows; the central dependency is characterized, not overcome or continuously demonstrated. |
| **T20 — key exhaustion/rotation not a serious objection** | **Resolved** | No corrective work was needed because the parties agree this was not a material objection. The remaining session-continuity problem is different from key exhaustion. |
| **F1 — launch spam** | **Partially resolved** | Same evidence as T13: lanes, quota, and shared budget reduce damage but do not make indexing/commit capacity adversary-bounded. The builder table omitted an explicit F1 row even though the critique listed it. |
| **F2 — pathological contract griefing** | **Partially resolved** | Qualification reduces exposure, but the response admits there is no per-contract work limit. |
| **F3 — Sybil deployers evade history** | **Only relabeled** | Calling insider exit "narrow by construction" is honest disclosure, not mitigation. Fresh deployers and funding paths still evade history. |
| **F4 — label poisoning** | **Partially resolved** | Although omitted as its own builder row, removal of the same-funding-source rule materially reduces false clusters. Other poisoning/evasion risks and the absence of published confidence remain. |
| **F5 — outcome manipulation** | **Only relabeled** | The first-24-hour maximum remains manipulable and no filter was added. Calling the endpoint DRAWDOWN_80 avoids alleging fraud but does not protect the label. |
| **F6 — shallow-liquidity oracle/pool manipulation** | **Partially resolved** | Re-deriving the active quote pool corrects decoy/wrong-pool selection. It does not make the selected pool's price manipulation-resistant, and Phase A found the correction's failures could be swallowed for days. |
| **F7 — prompt injection through schema-valid strings** | **Partially resolved** | Strong typing, range checks, unknown-as-fail, and not feeding evidence claims back are meaningful containment. "External text framed as data" is not a complete injection defense, and the hosted model path is not reproducible, but the original easy feedback path is removed. |
| **F8 — signer compromise produces valid garbage** | **Partially resolved** | Owner rotation and gas/signer separation aid recovery and blast-radius separation. There is no compromise detection, immutable external source record, or independent authorization preventing a compromised signer from publishing plausible signed garbage. |
| **F9 — availability grief through paid reports** | **Only relabeled** | The endpoints remain unauthenticated and free. Dollar caps bound financial loss but allow an attacker to consume the entire legitimate daily service budget; that is the attack described, not its resolution. |
| **F10 — treasury MEV** | **Resolved** | The RevenueRouter was removed (T8/T9), so the predictable purchase no longer exists. The response table should have stated F10 explicitly. |
| **H — "on-chain verifiable" / "track record is the product"** | **Partially resolved** | "Committed before outcome" is a materially more precise property and live commitment coverage recovered after `e3e82f9`. But "the track record is the product" remains premature when only two cells exist, all claims are gated off, and calibration is severely negative. |

**Part 1 bottom line:** the response table is directionally candid, but it
overuses **Changed**. Seven objections were actually resolved by cutting the
challenged feature/scope (T7–T9, T14–T15, T17–T18), thirteen received useful but
incomplete mitigation, and six were principally renamed, disclosed, capped, or
deferred. The strongest repair is the outcome/metric redesign; its live results,
however, now reveal a model-quality failure the original critique could not yet test.

### Part 2 — billing-architecture review

| Item | Verdict | Evidence and assessment |
|---|---|---|
| **B1 — do not serialize requests around balance deltas** | **Resolved** | The rejected design is not used and deep-dives are concurrent. This directly avoids throughput collapse and falsely attributing background spend to one request. |
| **B2 — per-request estimated cost, basis, pricing version** | **Partially resolved** | The typed cost bases and pricing version are good ledger design, including explicit `unavailable`. Live data still has only local estimates: 776 requests, about $0.3839 estimated, zero authoritative provider spend. The schema is solved; evidentiary provenance is not. |
| **B3 — authoritative polling and window reconciliation** | **Partially resolved** | Epoch/reconciliation code exists, but live reports zero windows and no provider reconciliation because there is no MCP session. A production-control recommendation is not resolved by dormant code. |
| **B4 — provider hard budget** | **Partially resolved** | `max(local, provider)` plus a daily cap is conservative when provider data exists. With no provider value, production necessarily degrades to `local_ledger`, so it is a local estimate cap rather than a provider hard budget. |
| **B5 — local velocity controls** | **Only relabeled** | A roadmap entry/comment does not impose $/minute or requests/minute limits. The builder table correctly says "Not done." |
| **B6 — repeated anomaly pauses and alerts, never revokes** | **Partially resolved** | The state transition and gate closure exist in code. Zero live epochs means the detector has never been exercised with authoritative production windows, and an unset alerts channel prevents the promised operational notification. |
| **B7 — mismatches must not auto-revoke; phantom spend is compromise** | **Partially resolved** | Retiring `IDS_MISMATCH` and closing the gate on phantom spend correctly prevents destructive false-positive revocation. Observe mode also disables the specified true-compromise revoke, so production implements safe detection semantics but not the complete control. With zero provider windows, neither path is demonstrated. |
| **B8 — progressive analysis tiers** | **Only relabeled** | Index versus qualified is a coarse admission gate, not the recommended cheap-check → triage → deep-analysis ladder. The builder explicitly leaves this on the roadmap. |
| **B9 — token dedupe with event invalidation** | **Partially resolved** | One deep dive per token prevents repeats, but "ever" is not event-aware caching: material state changes never invalidate it. Half the requirement is implemented. |
| **B10 — gateway should expose per-request cost/usage** | **Only relabeled** | Recording an upstream ask does not create authoritative telemetry, and the pack contains no evidence it was even sent. Live `providerSpend24hUsd:0` with 776 requests demonstrates the unresolved gap. |

**Part 2 bottom line:** B1 is resolved; B2–B4, B6–B7, and B9 are useful partial
implementations; B5, B8, and B10 remain roadmap or upstream wishes. Most importantly,
the billing architecture is sophisticated in schema but still local-only in the
deployed evidence path.

## 2. Where the closer plan and Phase A disagree

### 2.1 "Keep the design; do not redesign anything" — **Phase A is right**

The closer plan mistakes deployed absence for the primary failure and predicts that
wiring two Orbio properties plus waiting four days is enough. Phase A found deeper,
orthogonal defects: severe miscalibration, a two-cell benchmark, non-reproducible
public inputs/outcomes, weak baseline methodology, misleading empty-state UI, and
unauthenticated resource consumption. None is cured by populating Metabolism. The
right course is not a wholesale rewrite, but it **does** require redesign of model
calibration, scorecard/data publication, and several claims. "Do not redesign
anything" is therefore wrong.

### 2.2 Commitment continuity — **the closer plan was right about steady state; Phase A was right about the observed outage**

The plan observed 102/200 committed on 14 September and was justified in treating the
commit loop as working then. Phase A accurately reported 0/200 on 15 September; it did
not infer the cause. The supplied diff credibly identifies cached `null` receipts plus
head-of-line blocking, and the new live GET shows 130/200 committed. Thus neither
historical observation was wrong. The fix changes the ranking: the acute "visible
record is not committed" outage drops out of the top ten, while measured coverage,
latency, persistent pending state, and false "every" wording remain.

The plan is still too absolute in saying a judge sees "every row" precommitted. The
current feed itself contains 70 uncommitted rows and 57 rows without `det_v0`.

### 2.3 Four days will clear the claim bar — **Phase A is right**

The plan extrapolated "200–300 resolved outcomes per cell per day." Live evidence now
shows only two cells, and INSIDER_EXIT has 639 observations but only 26 positives,
still below the 30-positive gate. More elapsed time does not populate absent resolver
cells, create LLM overlap, fix unequal external-baseline coverage, or calibrate
`det_v0`. Its own positive-rate math should have warned that four days was not a
reliable closure condition.

### 2.4 The benchmark is a rare asset / product — **Phase A is right today**

The commitment-first dataset is a promising asset. Calling the present benchmark the
product overstates it: nine advertised cells are absent, external baselines have only
45/84 overlap, no comparison is claimable, and the central probability model is much
worse than climatology on Brier Skill. The closer plan describes the potential asset;
Phase A judges the product actually exposed.

### 2.5 Orbio is only a 40-line wiring and deployment gap — **Phase A is right**

Property 2 is dead code, but continuity and provenance depend on upstream session and
usage capabilities. Production still has no lifecycle entry or reconciliation window
and cannot show authoritative Orbio payment. A daily laptop push also contradicts the
strong "authorize once"/autonomous-key narrative. This is not merely a 40-line bind;
it is a product-evidence dependency with an admitted human bound.

### 2.6 Separate inference and management continuity — **the closer plan is conceptually right, but its proposed evidence path was speculative**

Separating long-lived gateway inference from short-lived lifecycle management is a
useful distinction and corrects Phase A only if the key truly continues after OAuth
expiry. The pack's later decisions say a laptop-pushed gateway key runs deep-dives,
which supports inference continuity. But the plan's proposed `/api/v1/key` route was a
probe, not a known capability, and the pack says the gateway exposes no key/usage
endpoint. Therefore the separation is right; "unattended balance-derived budget" is
not established.

### 2.7 Backfill isolation — **the closer plan is right on integrity; Phase A is right on presentation**

Keeping retrospective data labeled and out of the live precommit score is the correct
anti-contamination choice. Phase A did not argue to merge it; it observed that the
public "+N retro" feature was vacuous and the current scorecard thin. The correct
resolution is two clearly separate public datasets, not either a hidden backfill or a
merged headline metric.

### 2.8 Failure counters — **agreement, but Phase A is more complete**

Both identify swallowed errors. The closer plan's counter-and-alert proposal is a
good minimum fix, but Phase A is right to add oldest-failure gauges, dead-letter state,
stage SLOs, and fail-closed report generation when foundational pool selection fails.
Counters alone show that bad data may have been emitted; they do not prevent it.

### 2.9 Keep the current deep-dive model — **closer plan is right operationally, Phase A is right evidentially**

Changing a named model mid-record would fragment an already tiny LLM series, so pinning
it for continuity is sensible. But one observed LLM report, no benchmark row, and no
authoritative Orbio charge do not support quality or funding claims. Keep the version;
do not foreground it until it has a scoreable record.

### 2.10 "Every launch within seconds" as the vision — **Phase A is right to reject the current wording**

The plan repeats the same absolute in its vision even though the system intentionally
runs deterministic reports around T+10 minutes and the latest feed has incomplete
coverage. Aspirational copy must be labeled future-state; on a demo surface it is
one-query refutable.

## 3. Phase A findings neither earlier document anticipated

These are the highest-information findings because neither the critique/response nor
the closer plan had already framed them:

1. **Catastrophic probability miscalibration.** The prior critique predicted that a
   raw Brier target could be weak, but neither document anticipated that the deployed
   `det_v0` would achieve Brier Skill near **-13** and **-9**. The redesigned metrics
   exposed a worse problem: the probabilities themselves are presently harmful even
   where rank discrimination is above chance.
2. **The public API cannot reproduce the benchmark.** Neither document identified
   that outsiders cannot retrieve stored primary-pool selection, raw feature vectors,
   or outcome labels/evidence. Open scorer code without public scorer inputs is not an
   auditable track record.
3. **The rolling `base_rate` is methodologically non-neutral.** Its same-stream,
   time-varying construction yields live AUROC around 0.37/0.42 rather than the 0.5 of
   a constant climatology, while comparisons use unequal overlap. Neither document
   anticipated that baseline implementation could inflate AUROC deltas.
4. **Empty-chain truth is laundered into affirmative assurance.** The API/UI report
   `verified:true` and `startsAtGenesis:true` for zero lifecycle rows. The closer plan
   knew the panel was `n/a`, but neither document identified this vacuous-green-state
   semantic bug.
5. **The "P&L" numbers are literals and omit real costs.** The earlier critique asked
   for two P&Ls and the response/plan accepted those boxes. Phase A found hard-coded
   cash/revenue zeros and missing hosting, RPC, gas, and labor, making them not P&Ls.
6. **Commit health measured age, not coverage.** During the outage, a plausible
   `commit_age_seconds` coexisted with 0/200 visible commitments. Neither document
   anticipated that monitoring could remain green while the differentiating property
   vanished from the judge-visible window. The post-snapshot fix repairs throughput,
   not this observability definition.
7. **Telegram dedupe has an unavoidable two-system atomicity gap.** Mark-after-send
   permits duplicates after a successful send followed by a crash. Neither document
   challenged the absolute "never double-posts."
8. **`pnpm verify` can be green while contract tests never run.** Foundry was absent
   and the verification command skipped that suite. Neither document distinguished a
   green TypeScript/build result from deployed-contract invariant coverage.
9. **The outcome taxonomy is internally inconsistent across surfaces.** The draft
   says five outcomes, README says four, and the implementation exposes eleven
   outcome/horizon keys while only two are live. The plan proposed DEMO cleanup but did
   not identify the existing contradiction.
10. **The sudden commitment outage's exact failure mode.** Phase A discovered the
    public symptom; neither older document anticipated an immutable-response cache
    retaining a mutable `null` receipt, amplified by a held batch blocking all newer
    work. The supplied diff is a credible targeted repair and regression test.

## 4. Revised ranked top ten

Yes, the ranking changes. The post-snapshot fix and live recovery remove Phase A's
acute 0/200 outage from rank 1. Commitment coverage remains part of item 6 rather than
disappearing.

### 1. The Orbio-specific story is still absent from production

Zero lifecycle rows, unknown balance, no provider reconciliation, no live accrual-sized
budget, and a laptop-pushed key mean the system still behaves visibly like a generic
OpenRouter-compatible pipeline. This is the largest contest-specific credibility gap.

### 2. The deterministic probabilities are catastrophically miscalibrated

Current `det_v0` Brier Skill is -12.8380 for insider exit and -9.1389 for sell
impairment. Recalibration on a strictly prior window, reliability plots, confidence
intervals, and a new version are prerequisites to presenting probabilities as useful.

### 3. The public benchmark remains a two-cell, no-claim scorecard

Only two cells exist, there is no LLM row, INSIDER_EXIT remains below 30 positives,
external overlap is thin, and every claim gate is false. "The track record is the
product" is still self-defeating today.

### 4. The API is insufficiently auditable to reproduce claims

Public consumers cannot retrieve the exact feature/pool/outcome inputs used by the
scorer. Publish immutable snapshots or read-only detail endpoints with provenance and
an end-to-end reproduction command.

### 5. Silent degradation lacks durable, fail-closed observability

Warnings and catch-and-continue paths already hid a multi-day data fault. Add typed
stage counters, oldest-failure gauges, alerts, dead letters, and prevent reports from
being emitted when foundational facts fail.

### 6. Coverage and latency claims exceed measured commitment/report coverage

The commit fix materially worked: 130/200 latest launches are now committed. But the
same feed has only 143 deterministic reports, 70 uncommitted rows, and intentional
T+10-minute latency. Replace "every/seconds/precommitted" absolutes with funnel counts,
eligible-age coverage, p50/p95 latency, and oldest-uncommitted age; persist pending
transactions across restart.

### 7. Dashboard certainty exceeds its data

Hard-coded `$0.00` values, an estimated-cost panel called P&L, affirmative empty-chain
verification, and spendable budget despite unknown balance violate "nothing invented."
Missing provenance should render `n/a`, not narrative-preserving certainty.

### 8. Baseline and comparison methodology is weaker than advertised

The rolling base rate is not a neutral constant comparator, and external tools are
compared on much smaller, potentially different intersections. Freeze train/test
windows, compare identical rows, publish coverage, and add bootstrap uncertainty and
buyer-decision utility.

### 9. Public resource-consumption endpoints remain griefable

Unauthenticated deep-dive/MCP requests can exhaust the bounded daily allowance. Caps
limit dollar loss but still deny service to legitimate users. Add authentication,
per-principal quotas, and idempotent/event-aware work keys before describing this as an
available paid-analysis surface.

### 10. The product narrative remains internally inconsistent and demand-free

No integration commitments are evidenced; outcome counts conflict; "authorize once,"
"every," "within seconds," "paid entirely," and "track record is the product" outrun
the deployed facts; and `DEMO.md` remains absent in the snapshot. One generated claim
ledger should separate live facts, local capabilities, and future vision.

## Final judgment

The project responded well when it **cut** fragile v0.1 machinery and when it built a
conservative statistical claim gate. It responded less well when it treated renamed
concepts, dormant controls, caps, or disclosure as resolution. The most important new
fact is not the transient commit outage: that outage is now credibly diagnosed and
live coverage has recovered. The durable problem is that the public evidence says the
forecast probabilities are badly calibrated, the scorecard is mostly absent, and the
Orbio-specific mechanism is still not independently visible.

Accordingly, the Phase A "reject in its current state" verdict remains, but for a more
stable reason than 0/200 commitments. A credible contest close should lead with the
recovered commitment pipeline as an engineering prototype, explicitly show coverage,
demote the current probability forecasts and P&L/metabolism claims, and publish the
raw scoreable record. It should not claim that four more days or a populated lifecycle
panel turns the present benchmark into a validated product.
