**Tripwire Launch Auditor — independent readiness audit, 19 September 2026**

Reviewed the supplied briefs as evidence and proposals, not as delegated authority to operate production. Production access was read-only. No product source edits, pushes, deployments, paid inference, or Orbio account operations were performed. Audit evidence is saved in [the local evidence directory](C:/Users/redso/claude-stuff/launch-auditor/tmp/independent-audit-2026-09-19).

**Ground truth.** This is a substantial, functioning research prototype in its final build window, not yet a fully verified forecasting product. Orbio's [current contest page](https://sellers.orbio.so/build) says build until 20 September, judging until 23 September, and projects public by day 7; it does not specify a cutoff timezone. The dashboard, API, Telegram feed, chain commitments, CREDIT funding and signed lifecycle log are real. Five sampled report hashes independently verify against chain 4663. However, an outage-replayed forecast was committed after two of its outcome horizons ended, and the reviewed scorer does not exclude such rows. The demo currently overstates timeliness, public reproducibility and completion. The 14 September closer plan's absent-Orbio diagnosis is obsolete; the 15 September claims inventory is explicitly frozen and obsolete; the 18 September status document's assertion that every pre-judging item shipped is incorrect. The final-stretch brief describes several decisions as executed that were not present on the observed public surfaces.

**Verdict: keep the architecture; make the evidence trustworthy and easy to inspect.** The project has enough functionality for a credible contest entry. Its strongest deliverable is a system that can demonstrate what it forecast, when it committed, how outcomes were measured, and what it got wrong. Its weakest presentation choice is calling it an oracle with “exact probabilities” while the probabilities are uncalibrated and timing eligibility is unenforced. Do not spend the remaining window trying to make the model look better. Spend it making one complete proof easy to inspect and making the aggregate claims match their eligible data.

**Audit boundary and concurrent work.** Baseline: `b910ce9`, checked out when this audit began. Public evidence was captured approximately 01:29–01:55 UTC on 19 September. While the audit ran, another process committed `a2603e7` at 01:46 UTC: two-row rank tiers, a calibration caveat and a feed freshness filter. That is real progress in source; it does not fix scorer eligibility or the dashboard. At the 01:55 feed fetch, the latest visible post was 01:46:19 UTC and all 20 visible posts still used the previous probability format. Additional uncommitted scorer/coverage work appeared during closeout. Findings below describe the captured deployment and baseline; in-progress edits are not certified fixes. Run acceptance against a named final deployed commit.

**Claims and evidence**

| Claim | Evidence used | Verdict | What can actually be said |
|---|---|---|---|
| Report hashes are anchored on chain | Five independent Merkle computations, transaction receipts, registry events and block timestamps | Proven for the sample | Five hashes match successful registry commitments; this is not a census. |
| Every forecast was committed before its outcome | Replay sample below; `assemble.ts`, `enumerate.ts`, `collect.ts` | False as a universal claim | One report was committed after its 1h and 6h horizons. Its outcomes were still pending at inspection. |
| Benchmark is exclusively timely, precommitted forecasts | Scorer filters validation and outcome retrospective flag, not commitment/time | Unproven and unenforced | `retrospective=false` is not proof of timely issuance. Current claimed cells need an eligibility audit. |
| `det_v0` beats both base rates on three cells | Saved `/v1/benchmark`, generated 01:29:06.983 UTC | Partial | Published counts and significance flags support those comparisons on the selected graded rows. Underlying samples were not independently reconstructed. |
| The ≥200 / ≥30-positive / significance gates protect every claim | Aggregate checks and a local scorer counterexample | Partial | Published aggregate checks pass; the code counts positives outside the paired comparison. |
| Probabilities are usable as probabilities | All seven measured `det_v0` Brier skills are negative | Unproven | Ranking performance on selected cells does not establish calibration or trading utility. |
| LLM improves discrimination | `llm_deepdive_v0`: 330 insider-exit grades, 29 positives, AUROC 0.463 | Unproven | “No evidence of improvement yet” is justified; “LLMs cannot help” is not. |
| Orbio-funded autonomous work is real | Funding API; four independently decoded activation receipts; chain CREDIT balance; 50 independently checked lifecycle bodies/signatures | Proven within these bounds | Receipt amounts, senders and beneficiaries match 20 operator-activated + 6 agent-activated CREDIT; wallet holds 24 CREDIT on chain. Human supplied funding. |
| Metabolism displays the worker's actual budget | Live display/API plus independent formula counterexample | False in general | Its balance is consistent, but its remaining budget and potentially its binding constraint differ from the worker. |
| Wallet is restricted to activate-only | `credit-wallet.ts`, `lifecycle-runner.ts` | Partial / overstated | The live activation path calls `activate`; the helper also permits configured `Staking.claim`. This is an application check, not a restricted signer or contract-enforced wallet policy. |
| Anyone can independently reproduce the public benchmark | Public endpoint schemas, newest-200 enumeration limit, report-history filtering, anonymous repository requests | Partial | Code and some inputs exist locally/publicly, but a complete public reconstruction path is missing. |
| Repository is public and ready for judges | Anonymous GitHub REST request and normal webpage both returned HTTP 404 | Not demonstrated | Could be private, missing or the wrong URL. Judges cannot clone the cited URL anonymously as observed. |
| Verification is green | Isolated tracked-file export of `b910ce9`, fresh dependency installation, no `.env` | Proven with a limit | 571 tests passed, plus typecheck and Prisma checks. Contract tests were skipped because Foundry is absent. |

**Fixes in priority order**

Effort estimates are focused implementation minutes for Cooper directing Claude Code, including targeted verification, excluding deployment and backlog drain. These are estimates, not completion promises.

| Priority | What / why / who notices first | Concrete fix and acceptance condition | Effort / owner |
|---|---|---|---|
| 1 — release blocker | Timeliness is not enforced in the scorecard. A technical judge can invalidate the headline promise with one report. | Add explicit per-report/per-outcome eligibility based on confirmed chain time; classify uncommitted, late, missing-time and eligible rows. Exclude already-ended horizons from claims immediately. Separate outage replays; preserve original signed records. Recompute claims and publish exclusion counts. Tests must include this audit's replay example. | 120–240 min, Claude |
| 2 — release blocker | The cited repository returns 404 anonymously. A judge cannot inspect the scorer or run the project. | Verify the actual remote and intended public URL; complete a redacted credential scan, then the owner publishes or corrects the URL. Acceptance: logged-out page access and anonymous clone of the final submitted commit. Do not infer accessibility from an authenticated owner session. | 15–30 min plus owner action |
| 3 — high | The public proof proves membership of a supplied hash, not that the displayed forecast produced that hash. An engineer hits this immediately. | Serve the immutable canonical report and EIP-712 signature by report hash, plus chain timestamp and outcome links. Provide one offline verifier from canonical bytes → hash → signer → Merkle root → registry event. Link the dashboard and feed to this report-specific route. Acceptance: independently verify one completed example without the DB or operator's credentials. | 60–120 min, Claude |
| 4 — high | The cold demo's Live launches table has no usable forecasts/proofs during replay. Recent cursor writes look healthy while the system remains hours behind. | Show chain-head-to-cursor lag, eligible report coverage, committed coverage and report-age distribution. Preserve replay but reserve capacity for current work if it can be done safely. Label catch-up state. Put a real completed example above the newest-launch table. Acceptance: a cold visitor can complete the proof path even during catch-up. | 60–120 min; recovery time uncertain |
| 5 — high | The benchmark page makes contradictory and misleading claims. Judges see “no backfilled rows” next to “+165 retro”, and a green badge on AUROC 0.366. | Render one authoritative eligible cohort; derive provenance from rows, not `all.n-live.n`. Make scanner anchor selection deterministic. Show inverted labels, paired n/positives, coverage/pending/unresolvable counts by horizon and resolution policy. Use paired positives in gates; suppress metrics below the stated minimum or revise that policy explicitly. Label pairwise wins so beating an inverted comparator cannot imply useful performance. | 90–180 min, Claude; some coverage work in progress |
| 6 — high | The Orbio panel misstates the actual daily budget. This is the protocol-specific demonstration. | Reuse one budget calculation and one spend window, or expose the actual last worker gate snapshot. Show configured ceiling, effective CREDIT-based cap, spend, remaining allowance and observation time separately. Surface fallback/unknown provenance. Acceptance: the $0.90-spent counterexample below gives the same result in worker and display. | 45–90 min, Claude |
| 7 — high | Feed, dashboard, README, demo guide and film tell different stories. A screenshot can refute the presentation. | Deploy and observe `a2603e7`; extend calibration/inversion language to the dashboard. Remove “within seconds”, “every”, “exact probabilities”, “only human action possible” and unsupported custody absolutes. Update the frozen claims inventory or clearly designate a current replacement. Treat the film as a mechanism illustration until a real proof replaces its illustrative example. | 45–90 min after core fixes, Claude + Cooper |
| 8 — operational | Alerting does not monitor catch-site failures, chain lag or report coverage. A send failure is swallowed but still marks the alert delivered. | Retry failed alert delivery; add alerts on meaningful backlog/freshness degradation and failure-rate increases. Confirm the correct private destination and an actual overnight responder. Check real provider RU consumption and paid service runway; a request/min cap is not a monthly RU budget. Acceptance: simulated failed send retries, and behind-head replay does not appear healthy solely because the cursor moved. | 45–90 min + Cooper's provider checks |

**The timing defect, independently demonstrated**

The deterministic builder assigns `reportTime` from the historical T+10m block, not wall-clock issuance: [assemble.ts](C:/Users/redso/claude-stuff/launch-auditor/apps/worker/src/report/assemble.ts:113). Outcome anchoring to that field is real: [enumerate.ts](C:/Users/redso/claude-stuff/launch-auditor/apps/worker/src/outcomes/enumerate.ts:24). Therefore “horizons use reportTime” does not make an outage replay timely. [collect.ts](C:/Users/redso/claude-stuff/launch-auditor/apps/worker/src/scorer/collect.ts:106) loads all validator-passing reports and joins resolved outcomes without a commitment or timeliness check. Replays retain trigger `launch` and `retrospective=false`.

| Telegram post | Report time, UTC | Actual commitment block time, UTC | Delay | Independent Merkle + registry checks |
|---|---|---|---|---|
| [3180](https://t.me/tripwirelaunchauditor/3180) | Sep 17 13:34:13 | Sep 17 13:34:40 | 27 sec | Pass |
| [3199](https://t.me/tripwirelaunchauditor/3199) | Sep 17 13:58:33 | Sep 17 14:03:49 | 5m 16s | Pass |
| [3880](https://t.me/tripwirelaunchauditor/3880) | Sep 18 04:19:33 | Sep 18 04:24:23 | 4m 50s | Pass |
| [3899](https://t.me/tripwirelaunchauditor/3899) | Sep 18 05:28:44 | Sep 18 05:33:48 | 5m 04s | Pass |
| [4117](https://t.me/tripwirelaunchauditor/4117), outage replay | Sep 18 13:47:34 | Sep 19 01:24:19 | **11h 36m 45s** | Pass, but 1h and 6h horizons already ended |

The replay token is `0xafb2e8581cc8e7c125163d1efe0061d8632ee458`; [report](https://api-production-6a84.up.railway.app/v1/report/0xafb2e8581cc8e7c125163d1efe0061d8632ee458), [outcomes](https://api-production-6a84.up.railway.app/v1/launch/0xafb2e8581cc8e7c125163d1efe0061d8632ee458), [transaction](https://robinhoodchain.blockscout.com/tx/0x37574b3c792eecf81af77a940ad37cc64ddd277eb42b39ef001b499c11a4392a). Its 11 outcome rows were still PENDING when inspected. **This proves eligibility is broken; it does not prove this particular report is already included in the three advertised wins.** A full census is required to establish their contamination, if any.

The API's `committedAt` for that transaction was 01:29:00.233, almost five minutes after its actual block time. Do not use the DB receipt-recording timestamp as exact chain time. All five proof responses returned `onChainConfirmed:null`; direct public-RPC receipt/event checks succeeded. That is an API confirmation-path gap, not evidence the commitments are absent.

A commitment before horizon end is only a minimum check. Cumulative events such as insider exit can become knowable earlier. For late reports, separate feature cutoff, issuance, chain confirmation and observation window, and define the claim precisely. Do not silently re-anchor or rewrite old signed reports to make them pass. A conservative short-term solution is to quarantine outage-replayed reports from headline claims and retain their descriptive results with explicit provenance.

**What the current statistics support**

The saved live snapshot reports the following. The three advertised positive comparisons pass the published aggregate n/positive-count checks. Their reported two-sided DeLong p-values against rolling/fixed baselines are respectively 0/0, 0/0 and 0.0184/0 for the first three rows; zero means rounded output, not a literal zero probability. I checked the reported gates, not an independent recomputation of DeLong from raw paired observations.

| `det_v0` cell | n / positives | AUROC | Brier skill | Interpretation |
|---|---:|---:|---:|---|
| INSIDER_EXIT@24h | 835 / 91 | 0.7646 | −2.4780 | Ranking result on graded cohort; probabilities poor |
| TRADING_ALIVE@24h | 5,259 / 196 | 0.6523 | −0.9764 | Ranking result on graded cohort; probabilities poor |
| INSIDER_EXIT@6h | 2,736 / 177 | 0.6338 | −7.5063 | Weaker ranking result; heuristic AUROC is higher |
| LIQ_IMPAIRED@24h | 3,048 / 1,061 | 0.3661 | −0.1269 | Inverted; nevertheless receives a green “beats heuristic_v1” badge |
| DRAWDOWN_80@24h | 1,227 / 231 | 0.3442 | −3.5847 | Inverted |
| SELL_IMPAIRED@1h | 700 / 642 | 0.3371 | −10.4409 | Inverted and explicitly descriptive |
| SELL_IMPAIRED@24h | 168 / 148 | 0.6010 | −6.5578 | Below the claim-size bar; descriptive |

The 30-positive check uses the model's whole cell, not aligned labels in each comparison. A local reproduction with 240 model observations / 40 positives, but only 205 overlapping baseline observations / 5 positives, returns `claimAllowed:true`. This is a real gate defect; I have not established that a current displayed badge exploits it. [Reproduction output](C:/Users/redso/claude-stuff/launch-auditor/tmp/independent-audit-2026-09-19/gate-check.json).

The page also displays AUROC 0.458 and Brier −2.294 for an LLM sell cell with n=79 while promising not to show metrics below 100. An “insufficient” badge does not implement that promise. The API reports pairwise overlap n, but the dashboard hides it.

Scanner cohorts differ materially between `all` and `live` in the same saved snapshot: drawdown 227 versus 127, insider 24h 795 versus 657, trading alive 402 versus 237, but insider 6h **1,353 versus 1,467**. A retrospective-inclusive superset cannot explain that last direction by itself. The UI's inferred “retro” badges are unreliable. The collector's unordered report iteration repeatedly overwrites `launchAnchor` for a launch, which warrants investigation as a cohort-selection cause; the exact cause was not proven against the production DB. Build both sections from one consistent dataset with an explicit scanner anchor rule.

**Resolution bias and freshness**

At 01:30:50 UTC, newest-report launch delay was 32,734 seconds (9.09h). The newest 200 returned launches were already approximately 3–3.5h old and **none had a deterministic report or commitment**. This is not the normal “too young for T+10m” sampling trap. At 01:47:43, newest-report delay remained 31,410 seconds (8.72h), eligible 1–2h report coverage was 0, and 219,599 horizon-due outcomes were pending. The five labels totaled 1,475 resolved outcomes in the trailing day. This is not evidence that waiting overnight will finish the record; some pending rows are deliberately outside the active resolution policy.

The resolver applies qualified-only selection to expensive labels while drawdown/survival remain universal, uses older-horizon-first selection within labels, retries failures, and can mark persistently failing measurements unresolvable. Insider-exit results therefore describe selected qualified launches and successful measurements, not all launches. Older resolved cohorts may differ from recent launches; outages and difficult-to-measure pools can create missingness related to the outcomes. Survival is less restricted by qualification but still subject to age and measurement selection. **The direction and size of bias cannot be estimated credibly from the aggregate endpoint.** Show per-cell denominators and excluded reasons; do not adjust AUROC speculatively.

The watcher metric uses time since cursor update, not distance from chain head: [metrics.ts](C:/Users/redso/claude-stuff/launch-auditor/apps/api/src/metrics.ts:86). During replay it can look healthy while current launches remain unprocessed. Failure counts were large, but mostly old; `commit.loop_error` stayed at 705 between the two saved snapshots while its last-error age increased. I did not find evidence in those two snapshots of a new continuing commit-error burst, and cannot assign causes without worker logs. The alert loop only checks its four original conditions; failure counters alone do not alert. A failed Telegram send still advances `lastBad`, preventing retry while the same bad state persists: [alerts.ts](C:/Users/redso/claude-stuff/launch-auditor/apps/worker/src/alerts.ts:127).

**The Orbio evidence is much stronger than the old plan says, but the display remains wrong**

Live `/v1/lifecycle` reported balance $25.42003, configured cap $5, CREDIT share $1, trailing spend about $0.01, remaining today $4.99 and per-run cap $0.20. The worker first computes an effective daily cap of `min($5, $1, spendable balance)`, then subtracts spend. The display subtracts spend from $5 and only compares the $1 CREDIT share, without deducting spend from it, at the final per-run minimum. Even using identical spend windows, after $0.90 spend the worker allows $0.10, but the display allows $0.20 and says $4.10 remains. See [budget-display.ts](C:/Users/redso/claude-stuff/launch-auditor/apps/api/src/budget-display.ts:60) and [worker budget loading](C:/Users/redso/claude-stuff/launch-auditor/apps/worker/src/deepdive/run.ts:120).

The API also uses trailing-24h spend while the worker uses UTC-day spend. The displayed “Credits accrued” is derived from positive balance changes; it should identify that derivation and distinguish activation from staking accrual. The worker falls back to its flat cap if activation reads fail, so a claim of an unconditional CREDIT-linked hard limit is too strong unless the fallback is disclosed or changed. `balanceUnknown` exists in the response but the inspected page does not render it. Current `epoch_reconciled` spend provenance is supported by recorded windows; it is not a per-request provider receipt or proof of total operating economics.

Fifty saved lifecycle bodies, EIP-191 signatures and internal links independently verified against the documented signer. The window does not start at genesis and contains the outage gap; valid signatures do not prove uninterrupted operation. Wallet-signature authentication removes session expiry, not dependence on RPC, funding, gas, provider availability or operator-controlled keys.

The keep-warm policy activates stockpiled, operator-supplied CREDIT to keep a rolling funding window open. That is measurable autonomous resource management. It is not evidence that market activity naturally determines useful research demand, that the agent earns income, or that the wallet cannot execute other actions if its private key is misused. Describe the demonstrated behavior directly.

**Prior-review follow-through**

| Accepted pre-judging item | Audit status |
|---|---|
| Live Orbio funding, lifecycle and property 2 | Substantially shipped; budget display/provenance mismatch remains. |
| `det_v0.1` | Present, but one graded observation is no evidence calibration improved. Intercepts alone cannot repair inverted ordering. |
| Resolver backoff/fair share | Implemented. Per-cell benchmark coverage promised in triage was absent from the captured endpoint; new coverage code was in progress during this audit. |
| Public scorer inputs | Launch detail is useful; canonical report, full history/enumeration and reproducible aggregate dataset remain incomplete. |
| Failure counters and alerts | Counters shipped; per-catch-site alerting did not. |
| Coverage/latency p50/p95 and committed-coverage alert | Newest-report lag and one report-coverage gauge exist; promised distribution/committed-coverage alert did not. |
| Honesty pass | Cost labels and empty Metabolism state improved. “Exact probabilities”, impossible absolutes, thin-cell metrics and misleading comparison badges remain. |
| Fixed baseline and overlap n | Both exist in API; paired-positive gate and dashboard presentation remain incomplete. |
| Deep-dive authentication | HTTP and MCP source enforce API-key checks; no production spending request was sent. |
| Public repo / verification / license | MIT license present; baseline verification passes with explicit Foundry skip; anonymous repo access fails. |

**Video and presentation**

The revision-03 film is visually coherent and concise. Its manifest explicitly labels it a working cut. I inspected the delivered transcript/captions, manifest and encoded landscape overview; I did not perform a frame-by-frame audiovisual review. Its 62% / 34% / 73%, hash and Yes/Yes/Yes sequence are illustrative, labelled once, not a production case. The dated 3,603 / 170 / 170 figures are resolved sample counts, not accuracy or a matched head-to-head result. Keep those distinctions on screen throughout the relevant scenes. “Stops trading” is the complement of the live “still trading” outcome and must remain correctly labelled when substituting real data. The Telegram end destination does not show the benchmark track record; point the contest audience to the completed evidence page or dashboard.

The cold DEMO.md path failed at step 3 because the current launch table had no proof to click. Even when populated, its `proofCell` links to the batch transaction, while the guide says it opens `/v1/proof/<hash>`. A clean stopwatch time cannot be claimed from this inspection; the path did not complete as written. Make the opening screen answer, in order: what was forecast; when was it committed; what happened; how well did the eligible cohort perform; what did Orbio fund. Internal labels such as “Metabolism”, “aggregate_only” and “binding constraint” should come after that explanation.

**Shortest credible closeout**

1. Freeze a reviewed commit and get timing exclusions and public proof bytes correct. If a complete cohort audit cannot finish before submission, withdraw universal precommitment and headline performance claims; publish the limitation rather than guessing corrected counts.
2. In the same release, correct budget display, claim gates and provenance labels. Use one completed, independently verified example as the demo's stable entry point. These are small product changes with unusually high judging value.
3. Confirm anonymous source access, observe the deployed feed change, and update the README summary, DEMO.md, current claims inventory and video destination together. Preserve archival documents as dated history, not current instructions.
4. Have Cooper verify provider RU use, service billing, gas/CREDIT runway and an overnight responder. Close with one logged-out walkthrough and one verification run against the final commit. Record both the deployment hash and evidence timestamp.

The complete list totals roughly 8–16 focused implementation hours, with timing eligibility and proof access first. If time is shorter, narrow the claims and deliver that proof path before improving the rest of the interface. No new service, chain, database, agent framework or paid tooling is needed. Keep the pinned inference model while this record is being evaluated. Use the existing TypeScript/viem/scorer tooling, public RPC reads and browser checks; a larger or different model cannot repair an eligibility error.

**Explicitly leave alone**

- Model weights, `det_v1` and a last-minute LLM swap: they start a new experiment, not a mature record. Fit on historical data or a declared training cutoff and score only subsequent forecasts after judging.
- Outcome definitions and the proposed liquidity applicability floor: plausible hypotheses, not established explanations. Analyze now if cheap; version forward later, without making current failures disappear.
- Retrospective imports into production: they add provenance risk and do not strengthen a timely live record.
- x402, monetization, multi-chain support, broader identity clustering and a new architecture: none fixes the current evidence path.
- Attempts to clear every historical pending row before judging: qualify the denominator and ensure honest current service first; expensive excluded history is not a prerequisite for a credible demonstration.
- A major film redesign: fix factual labels, the example/proof and destination. The visual system is already adequate.

**What remains unverified**

No production DB census, worker logs, private ops messages, Railway/Chainstack billing, complete paired score rows or confidential contest submission were accessed. Consequently I cannot certify exact corrected AUROCs, DeLong p-values, the number of already-scored late rows, selection-bias magnitude, measured monthly RU runway, overnight alert receipt, a complete source-history secret audit, or final deployment of concurrent fixes. The public repository's HTTP 404 prevented an anonymous remote clone; the green run used an isolated export of the local tracked commit with fresh dependencies. A local pattern scan covered 876 reachable source/text blobs; matches were localhost credential examples/verification placeholders, not identified live credentials. It is a useful screening result, not proof that every secret format or unreachable historic object is absent. No secrets are reproduced in this report.

**A judge's sixty-second verdict today**

“There is real engineering here: working chain commitments, a public scorecard that admits failures, and demonstrated CREDIT-backed agent operation. But I cannot yet rely on its strongest claim. A late replay looks like a live precommitted forecast, the public proof stops at a hash, and the cold demo leads to uncommitted rows. I would credit the infrastructure and candor, but withhold trust in the advertised forecasting record until timing eligibility and public reproducibility are enforced.”

**Recommended opening after those fixes**

“Tripwire tests whether token-risk forecasts deserve trust. Here is one forecast, its signed content, its chain timestamp and the outcome it was later graded against. The same scorer compares the eligible record with simple baselines and existing scanners, including the failures. Orbio CREDIT funds the agent's research: these are the operator and agent activation receipts, and this is the spending limit they produce. The probabilities are still uncalibrated, and the LLM has not yet demonstrated improvement. The contribution is an inspectable experiment that can expose its own weaknesses.”

I agree with holding model refits, retaining negative results and leaving production backfill out. I disagree with leading with “three wins” before the timeliness census: that is now a conditional result, not the safest proof of the mechanism. Rank tiers are a sensible feed presentation, but they still need cohort, freshness and calibration qualifications; they do not cure bad scoring eligibility.
