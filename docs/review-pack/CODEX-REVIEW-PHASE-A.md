# Codex independent review — 2026-09-15

Pasted verbatim from the Codex cloud task on `cavemancoop/tripwire-review` @ `c7a82c0`
(= `launch-auditor` `main` @ `d61dc20` + `docs/review-pack/`). Phase A only; Phase B
(response check against the prior critique and the closer plan) is pending.

Triage (accept / reject / defer, one line each) lives in `DECISIONS.md`.

**Builder's note on one finding (added at paste time, not part of the review):**
the 0/200-committed result in §1 and §2.1 was real at review time, but its cause
was a same-morning regression — the `rpc-budget` cache serving a cached `null`
receipt, amplified by the 05:27 UTC commit-loop change — not the steady state
before 2026-09-15 (102/200 committed on 09-14). See DECISIONS.md "Commit loop,
corrected the same day". The finding stands as written; the fix is recorded there.

---

# Phase A independent review — 2026-09-15 UTC

## 1. Claims table

Verdicts concern the live instance at review time, not whether a sentence exists in HTML. Commands were run from repository root. The live captures used below were `GET`s saved under `/tmp/tripwire-review`; no Orbio endpoint or production write endpoint was called.

| Claim | Evidence used | Verdict | Note |
|---|---|---:|---|
| A1 — "Precommitted exit-risk oracle" | `GET /v1/launches?limit=200`; `jq '[.launches[]\|select(.proof.committed==true)]\|length'` returned **0**. The UI nevertheless uses the headline (`index.html:17-19`). | **False live** | It is an oracle producing reports, but the entire visible 200-launch window was uncommitted. "Precommitted" is the differentiator, not decoration.
| A2 — own Orbio lifecycle / zero billing / credit throughput / continuity | `GET /v1/lifecycle?limit=500` returned `count:0`, `balanceUnknown:true`, no reconciled epochs. LIVE explicitly admits the production session is absent (`LIVE.md:108-109`). | **False live** | This panel leads with three properties of which production demonstrates none.
| A3 — plain-OpenRouter counterfactual test | Code calculates a dollar estimate (`app.js:169-186`); live response says 754 requests and estimated $0.3735 but provider spend 0. | **Partially proven** | It prices the counterfactual, but cannot prove the requests were funded by Orbio or that cash spent was zero.
| A4 — latest launches "with … commit proof" | Same 200-row feed check; 136 had `detV0`, **0 had a commit**. Rendering explicitly prints "not committed" (`app.js:192-215`). | **False live** | Most rows have no forecast; none has a proof.
| A5 — benchmark by outcome/horizon/forecaster | `GET /v1/benchmark` returned only `INSIDER_EXIT@6h` and `SELL_IMPAIRED@1h`; scorer types support the full grid. | **Partially proven** | The transport and calculation exist, but the dashboard cannot show the advertised outcome grid because nine of eleven cells have no resolved data.
| A6 — 100 to show, 200 and ≥30 positives to claim | Constants and gate are enforced (`scorer.ts:14-25`, `scorer.ts:128-146`); live snapshot exposed 100/200/30 and every `claimAllowed` was false. | **Proven** | This is one of the cleanest claims.
| A7 — "+N retro" meaning | UI computes `all.n-live.n` (`app.js:245-253`); live `all` and `live` snapshots were identical. | **Proven implementation; vacuous live** | No retrospective rows are deployed, so every badge is zero.
| A8, A15, A16 — signed lifecycle chain / verified genesis / bounded continuity | Verification description exists (`LIVE.md:100-101`); live returned zero rows, yet `verified:true` and `startsAtGenesis:true`. UI turns those booleans into "yes" (`app.js:156-163`). | **Misleading / unproven** | An empty chain is trivially valid. Displaying "chain verified: yes" and "starts at genesis: yes" for zero events launders absence into assurance.
| A9 — committed before outcome / reproducible scorer / nothing stronger | `pnpm verify` passed; production's latest 200 reports were not committed. | **Partially proven** | Scorer code is reproducible; the live commitment half failed in the judge-visible window.
| A10 — SELL_IMPAIRED descriptive only | Explicit suppression exists (`app.js:9-22`); live base rate was 351/388 = 90.5%. | **Proven** | The caveat is justified, though retaining a known-broken outcome consumes scarce dashboard attention.
| A11 — credits accrued/hr | Client derives positive balance deltas (`app.js:102-113`); live has no samples and renders `n/a`. | **Unproven live** | This is not an Orbio-provided accrual measure and cannot distinguish grants from other positive balance changes.
| A12 — spend/report | Client divides estimated spend by requests (`app.js:133-140`); live gave $0.3735 / 754. | **Partially proven** | Arithmetic is real; the numerator is a local token estimate with no provider reconciliation.
| A13–A14 — anomaly/phantom closure and stale-session disclosure | Gate closes anomaly/phantom but explicitly spends through stale/unknown balance (`budget.ts:89-135`). | **Proven in code; unexercised live** | No lifecycle observations exist, so live safety behavior could not be demonstrated.
| A17–A21 — P&L, $0 cash, Orbio-paid compute | UI hard-codes both revenue and cash spent to `$0.00` (`app.js:173-186`); live provider spend is zero and balance is unknown. | **Unproven; A20/A21 overclaimed** | "Paid entirely" and "cash spent $0" are not derived from evidence. A hard-coded zero directly violates A24/D10.
| A22 — transaction link for each committed launch | Link construction is correct (`app.js:192-195`); no committed row was present. | **Partially proven** | Code path exists; live surface supplied nothing to click.
| A23 — "beats baseline" only through gate | UI uses `claimAllowed`; live showed no allowed comparisons. | **Proven** | Correct restraint.
| A24 — every number is API-derived; missing is n/a | `$0.00` cash and revenue are literals; empty lifecycle renders affirmative verification; budget invents spendable balance from the cap when balance is unknown. | **False** | This is contradicted by the dashboard's own source.
| B1–B4, B6–B8 — Telegram message claims | Formatter emits the stated fields (`poster.ts:64-86`); tests passed. Telegram's public web mirror returned HTTP 403 to this environment. | **Partially proven** | Formatting is proven, live publication is not independently observable here.
| B5 — per-report API proof link | Conditional code is correct (`poster.ts:76-78`); production variable is documented unset (`HANDOFF-2026-09-15.md:109-118`). | **False live (as explicitly conditional)** | The most useful verification link is knowingly absent.
| C1 — every launch, seconds, five outcomes | Latest 200 contained 64 launches without `detV0`; report times for the ten random launches were roughly 10 minutes after launch, consistent with T+10 rather than "within seconds." README itself says four outcomes (`README.md:3-7`). | **False** | "Every," "within seconds," "five," and the repository's "four" cannot all be true.
| C2 — every forecast committed, scorer and public baselines | 0/200 visible launches committed; scorer code and public snapshot exist. | **False** | "Every forecast" is refuted by the public API.
| C3 — product is the track record | Live benchmark has only two cells, no claim clears the gate, and `det_v0` Brier Skill is -12.7997 / -9.1143. | **False as product claim** | There is a record, but it currently says the model is severely miscalibrated and incomplete.
| C4 — self-minted key, one-minute balance, accrual-sized budget, signed changes, no money | Dead-code search found `dailyDeepdiveBudget` only at its definition; the actual gate has no accrual input (`budget.ts:65-93`). Production has zero lifecycle rows. | **False** | The project's own handoff calls property 2 unimplemented (`HANDOFF-2026-09-15.md:20-22`).
| C5 — any ORBIO holder can authorize once and run | Quickstart also requires RPC, Postgres, Redis, registry address, and two private keys (`README.md:156-177`); OAuth continuity is about one hour. | **False** | "Authorize once" is specifically contradicted by the acknowledged expiring, non-refreshable session.
| C6 — dated counts and 27% still trading | Current benchmark does not expose launch totals or TRADING_ALIVE; field-report values are explicitly stale. | **Unproven** | No production DB and no endpoint capable of reproducing these counts.
| C7 — no LLM grades, thin cells, days-old record | Live random sample contained an LLM report, but benchmark contained no LLM cell; thinness remains. | **Partially proven / stale** | "No grades" still appears true publicly; "days old" is obsolete framing.
| C8 — registry address | Address is consistently published in LIVE (`LIVE.md:18-20`). | **Proven as configuration** | Deployment bytecode/ownership was not separately audited.
| D1 — every launch, four outcomes, signed+committed, later graded | Same live 200 check and benchmark check. | **False** | 64/200 lacked det reports, 200/200 lacked commits, and only two outcome cells were graded.
| D2 / E1 — existence, reproducibility, public comparison | `pnpm verify` passed; public snapshot exists; current reports lack commitment proof. | **Partially proven** | Two of three survive.
| D3 / E4 — any holder, no card/top-up/payment rail | Setup requires unrelated infrastructure and gas wallet; Orbio cash provenance could not be checked. | **Unproven / overstated** | "No payment rail" ignores on-chain gas funding and hosted infrastructure.
| D4 — only interactive step, ever | README makes the absolute claim (`README.md:173-185`); documented access token expires in about one hour without refresh (`HANDOFF-2026-09-15.md:16-20`). | **False** | "Ever" should not have survived known OAuth behavior.
| D5 — `pnpm start` runs all components | Script structure and README enumerate components (`README.md:180-186`); not run end-to-end because required services/configuration are absent. | **Partially proven** | Wiring exists; operational success could not be verified.
| D6 / E2 / E6 — autonomous key mint/manage/rotate/revoke | Production has a laptop-pushed gateway key and no lifecycle rows; observe mode gives up revocation. | **False live; partially implemented locally** | This is the core Orbio claim and it is not the deployed reality.
| D7 — lifecycle ordered and server-verified | API returns the documented shape, but only an empty chain. | **Partially proven** | Offline verification of real rows was impossible because there were none.
| D8 — proof plus best-effort on-chain confirmation | Implementation locally verifies Merkle proof then catches RPC failure to null (`server.ts:339-378`). | **Proven in code; unproven live** | No committed hash was discoverable from the 200-row feed.
| D9 — standalone vs subsidized dollars | The standalone estimate is displayed; subsidized cash is hard-coded. | **Partially proven** | The most favorable half lacks a source.
| D10 — no invented number | See A24. | **False** | Literal cash/revenue zeros and affirmative empty-chain status contradict it.
| D11 — stamp prevents restart duplicates | Poster marks after send (`poster.ts:129-143`). | **Partially proven** | A crash after successful Telegram send but before DB update produces a duplicate; "never" is false under the obvious two-system atomicity gap.
| D12 — verify scope and green result | `pnpm verify` passed Prisma generate/validate, 7-package typecheck and 503 tests; Foundry was skipped because `forge` was absent. | **Partially proven** | The green summary is real, but it is possible while contract tests never ran.
| E3 — LLM deep dive paid via Orbio and separately scored | One of ten random reports had `llm_deepdive_v0`; 754 requests were in the ledger; no LLM cell appeared in benchmark and Orbio payment was not authoritative. | **Partially proven** | Execution exists; scoring and funding claims are not demonstrated.
| E5 — daily budget follows trailing credits | Only the unused helper accepts `trailingCreditsUsd` (`budget.ts:31-49`); the live binding constraint was `cap_per_run`. | **False** | The distinguishing behavior is dead code.
| E7 — demo hinges on three Orbio-only properties and leads with them | Dashboard leads with the panel, but live proves none. | **Partially proven presentation; false substance** | It prominently advertises the empty part.
| N1–N7 — explicit non-claims | Copy disclaims profitability, human absence, and correctness; SELL is suppressed. | **Mostly proven** | "Nothing stronger" is contradicted by adjacent absolute claims ("every," "only … ever," "paid entirely," autonomous key management).

## 2. Ten most damaging weaknesses, ranked

### 1. The visible production record is not committed

- **What:** All 200 launches returned by the advertised live feed had `proof.committed:false`; 136 had forecasts and 64 had none. The metrics endpoint simultaneously reported a 260.718-second "commit age," which clearly is not a useful committed-coverage health measure.
- **Why it matters:** This deletes the product's only defensible differentiator. A forecast written to Postgres without an anchor can be rewritten after the outcome.
- **Who notices first:** Engineer or skeptical critic; a trader sees "not committed" repeatedly.
- **How to fix:** Stop publication until the commit exists; alert on uncommitted report count/oldest age; persist pending transaction state across restart; expose committed coverage and verify it in deploy health.
- **Effort:** **1–2 days**, excluding RPC remediation.

### 2. The Orbio-specific story is absent from production

- **What:** Zero lifecycle rows, unknown balance, no reconciled provider spend, laptop-pushed gateway key. The three headline metabolism properties are not demonstrated.
- **Why it matters:** Under the required "plain OpenRouter key" test, watcher, reports, Merkle batching, scorer, API, dashboard, and Telegram all work identically. Orbio is presently a billing anecdote attached to a generic agent.
- **Who notices first:** Orbio holder/judge.
- **How to fix:** Do not lead with metabolism until a durable, independently verifiable session lifecycle exists. Demonstrate claim/rotate/revoke and balance-derived throttling live for days, not a staged hour.
- **Effort:** **Several days plus an upstream OAuth/session solution**; not a copy edit.

### 3. The deterministic forecaster is catastrophically miscalibrated

- **What:** Live `det_v0` Brier Skill was **-12.7997** for insider exit and **-9.1143** for sell impairment. It emits near-1 probabilities frequently while insider exit base rate is 4.09%. AUROC around 0.65 does not rescue unusable probability calibration.
- **Why it matters:** Traders consume probabilities, not ranking trivia. These numbers imply far worse probabilistic decisions than predicting prevalence.
- **Who notices first:** Quantitative trader or judge who understands Brier scores.
- **How to fix:** Recalibrate on a strictly prior training window; version the calibrated model; show reliability curves and confidence intervals; stop foregrounding probabilities until positive Brier Skill holds out-of-sample.
- **Effort:** **3–7 days** plus data accumulation.

### 4. "Every launch / every forecast" is demonstrably false

- **What:** 32% of the latest feed had no det report, none had a commit, and sampled report timestamps were approximately T+10m rather than seconds.
- **Why it matters:** Absolutes invite one-query refutation and make more careful claims untrustworthy.
- **Who notices first:** Skeptical critic.
- **How to fix:** Publish explicit funnel counters: indexed → features complete → validator passed → committed → resolved. Replace "every" with measured coverage and latency percentiles.
- **Effort:** **1 day**.

### 5. The public benchmark is a two-cell artifact, not the promised scorecard

- **What:** Only 2 of 11 outcome/horizon cells appeared. There were no LLM rows. No comparison passed the project's claim gate.
- **Why it matters:** "The product is the track record" collapses when most of the record is absent and the remaining record is negative.
- **Who notices first:** Builder or engineer.
- **How to fix:** Diagnose resolver coverage per cell; expose pending/NA/unresolvable counts and lag; do not market the five-outcome grid until it populates.
- **Effort:** **2–5 days**, potentially longer for 7-day horizons.

### 6. Dashboard certainty exceeds its data

- **What:** It hard-codes `$0.00` cash spend and revenue, says an empty lifecycle chain is verified/from genesis, and derives spendable budget despite unknown balance.
- **Why it matters:** This directly violates "nothing invented." It makes the dashboard look designed to preserve the narrative through missing telemetry.
- **Who notices first:** Engineer inspecting network responses.
- **How to fix:** Render `n/a` for cash provenance and continuity when there are zero signed rows; distinguish local estimate, provider charge, and cash settlement; never turn an empty-set truth into a green status.
- **Effort:** **Half a day**.

### 7. Failures are routinely converted to logs without durable observability

- **What:** Primary-pool correction catches and warns (`t10.ts:113-116`); report assembly catches and continues (`t10.ts:275-288`); outcome sweeps catch at row and loop levels (`outcomes/loop.ts:123-135`, `outcomes/loop.ts:164-176`). The handoff admits this hid a two-day primary-pool production failure and still lists per-catch counters as unfinished (`HANDOFF-2026-09-15.md:80-81`).
- **Why it matters:** `pnpm verify` can be green while the actual data pipeline silently degrades.
- **Who notices first:** Builder, after corrupted coverage accumulates.
- **How to fix:** Typed failure counters and oldest-failure gauges per stage; dead-letter queues; SLO alerts; fail closed for report generation when pool selection fails.
- **Effort:** **2–3 days**.

### 8. The API is not auditable enough to reproduce its claims

- **What:** `/v1/launches` exposes only three probabilities and proof status; `/v1/report` exposes report evidence but not launch primary-pool selection, raw feature vector, or outcome records (`server.ts:201-219`, `server.ts:255-283`). In the random ten-launch audit, one token had no report and the other nine did not expose the requested pool/features/outcome resolution.
- **Why it matters:** "Open-source scorer" is irrelevant if outsiders cannot retrieve the inputs it scores.
- **Who notices first:** Integrating engineer.
- **How to fix:** Add read-only launch detail with pool-selection evidence, feature provenance/block, complete reports, and outcome labels/evidence; publish a snapshot dataset.
- **Effort:** **2–4 days**.

### 9. The baseline methodology is weaker than the presentation suggests

- **What:** The "base_rate" prediction is a rolling value computed from the same outcome collection; early observations fall back to all prior observations and start at zero. Its live AUROC was 0.3693/0.4222 rather than the 0.5 expected of a constant prevalence baseline. GoPlus/ScanHood overlap was only 44 or 83 observations, versus 388/635 for internal forecasters.
- **Why it matters:** An easy-to-beat, time-varying baseline and unequal coverage can manufacture impressive AUROC deltas while all Brier Skill values remain negative.
- **Who notices first:** Statistical reviewer.
- **How to fix:** Freeze training/calibration periods; compare on identical intersections; report bootstrap intervals; use a properly out-of-sample climatology baseline and disclose coverage.
- **Effort:** **2–4 days**.

### 10. The contest narrative is internally inconsistent and unfinished

- **What:** Five outcomes in the draft, four in README, eleven outcome/horizon keys in the API; `DEMO.md` is absent; "only interactive step, ever" coexists with a known one-hour OAuth bound.
- **Why it matters:** A cold judge cannot tell which specification is authoritative and will assume cherry-picking.
- **Who notices first:** Contest judge in the first minute.
- **How to fix:** One claim ledger generated from current surfaces; write DEMO.md; remove absolutes; state deployed facts separately from designed/local capabilities.
- **Effort:** **1 day**, after technical truth is settled.

## 3. Errors of judgment or narrative

1. **Leading with the weakest subsystem is not brave transparency; it is bad product judgment.** The first dashboard panel advertises three Orbio properties while returning zero evidence. Empty telemetry should demote the panel, not render green vacuous checks.
2. **"The product is the track record" is self-defeating today.** The actual record says no claim beats a baseline, nine cells are absent, and probability calibration is awful. Commitment quality and forecast quality are correctly distinguished in prose, then blurred by making the record the product.
3. **The project treats commitment as binary instead of measuring commitment coverage.** A few historical anchors do not make a stream "precommitted." The relevant KPI is the fraction committed before each horizon, plus latency and oldest uncommitted age.
4. **The dashboard calls cost estimates P&L.** There is no revenue, no verified cash settlement, no infrastructure/gas cost, and no authoritative Orbio charge. That is a usage-cost panel, not a profit-and-loss statement.
5. **"Zero-billing compute" is wordplay.** Credits have an economic source; Railway, RPC and gas are costs; the absence of a card at OpenRouter is not zero cost. The honest differentiated claim would concern authorization and subsidy mechanics.
6. **The plain-OpenRouter test currently fails.** Replace the gateway key and almost all visible functionality remains. The unimplemented accrual budget and absent lifecycle are precisely the only pieces that would change.
7. **A 90.5%-positive SELL_IMPAIRED definition should have been removed or versioned before collection.** Labeling it descriptive prevents a false "beat," but does not recover the engineering time or dashboard space.
8. **Catching RPC/data failures to preserve throughput prioritized row count over trustworthy rows.** The admitted primary-pool incident demonstrates that retry-plus-warning can systematically compute from the wrong pool.
9. **"Never double-posts" ignores distributed-systems basics.** Telegram send and the database stamp are not atomic. The claim should be "best-effort deduplicated."
10. **The docs use caveats as absolution.** A known limitation remains damaging when it invalidates the headline. Disclosing that Orbio is absent does not make the Orbio claim true.

## 4. What could not be verified, and why

- **Three random committed Merkle proofs:** could not verify. The advertised 200-row live feed exposed zero committed reports, so it supplied no eligible population from which to sample. Telegram's public mirror returned HTTP 403. Without a report hash, a registry root alone cannot recover a leaf. This is itself a severe availability finding, not permission to hand-pick old examples.
- **Ten-launch primary pools, features and resolved outcomes:** could not verify from the public API. Random tokens were recorded in `/tmp/tripwire-review/random-tokens.txt`; one returned 404 and nine returned reports, but the endpoint omits primary-pool and feature records and outcome labels. Direct historical reconstruction would not establish what production stored.
- **The scorer against production rows:** `pnpm scorer:run` failed because `DATABASE_URL` is absent. Per task rules I did not search for a credential. The public benchmark snapshot was inspected instead.
- **Production database rows and worker logs:** unavailable without operator access, as the pack itself states (`LIVE.md:84-86`).
- **Orbio funding, balances, cash settlement, key ownership and key lifecycle:** could not verify because Orbio endpoints were expressly forbidden and production exposes no signed lifecycle rows.
- **Telegram delivery/content:** formatter and tests were verified, but the public web endpoint returned 403 from this environment.
- **Contract test suite:** `pnpm verify` skipped it because `forge` is not installed. TypeScript Merkle tests passed; deployed bytecode and contract invariants were not reproduced.
- **Dated field-report counts:** no public raw dataset or aggregate endpoint reproduces them.
- **DEMO.md:** it does not exist. A sixty-second cold read of it is therefore impossible.

## 5. Sixty-second contest-judge verdict

**Reject in its current state.** The dashboard is visually organized but its first screen sells an Orbio lifecycle that has zero rows, then calls an estimated usage ledger "P&L," then shows a launch stream in which every visible proof says **not committed**. The benchmark is worse: only two cells exist, no beat is claimable, and the flagship probabilities are dramatically worse than prevalence on Brier score. There is no `DEMO.md` to explain the contradictions.

The engineering skeleton is real: the repository typechecks, 503 tests pass, the API is live, reports are generated, and the scorer has conservative claim gates. That earns technical credit, not finalist credibility. The differentiated Orbio behavior is either dead code, a local-only capability, or an unverifiable assertion. On the required counterfactual, this would work substantially the same with a plain OpenRouter key. A judge deciding in sixty seconds sees a generic chain-monitoring pipeline with an unfinished token-funded operations story and a broken proof surface—not a precommitted oracle ready for trust or integration.
