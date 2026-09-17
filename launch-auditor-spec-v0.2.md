# Launch Auditor v0.2 — Precommitted Exit-Risk Oracle for Robinhood Chain

Supersedes v0.1. Scoped to a seven-day Build Week entry that doubles as a demand experiment. Everything cut from v0.1 is listed in §11 with the reason.

## 0. What it is, in one paragraph

For every new token launch on Robinhood Chain, the agent computes a small set of deterministic manipulation and exit-risk features within seconds, publishes separate probabilities for five concrete, mechanically-defined outcomes
(eleven outcome×horizon cells in total), signs and commits the forecast on-chain before the outcome can be known, and grades every forecast later with an open-source scorer against those outcomes and against public baselines (base rate, a fixed heuristic, and existing scanners' scores). An LLM deep-dive, paid for with the agent's Orbio-funded key, runs on qualified launches and is scored as a separate forecaster so the dashboard shows whether the model adds discrimination over the heuristics. The agent claims, monitors, rotates and revokes its own OpenRouter key through the Orbio MCP. Revenue, if any, arrives over x402 in USDG at a plain address; there is no automated token purchase.

What it claims: the forecast existed before the outcome; the scorer is reproducible; the comparison to baselines is public. What it does not claim: that it pays for itself, that no human touched the server, or that the analysis is correct because it is committed.

### 0.1 The Orbio-specific test (standing red-team check)
"Would this demo work identically on a plain OpenRouter account with no token? If yes, it proves nothing about Orbio." The screener, commits and benchmark fail this test on their own; they are the work, not the proof. The demo therefore hinges on three properties only Orbio provides, and the dashboard leads with them:
1. Zero-billing compute: any holder clones the repo, authorizes the MCP, and runs an instance with no card, top-up or payment rail (fork-and-run, §8.1).
2. Credit-driven behavior: the daily deep-dive budget is spent from CREDIT activated into the agent's own on-chain account (spec §8, live 2026-09-16); every activation — who funded it and how much — is a public transaction (Funding, on the dashboard). Sizing the cap itself from trailing accrual, not a fixed number, is built and live: `min(dailyCap, 50% of CREDIT activated into the account in the trailing 24h, balance)`.
3. Unattended continuity: the key is a standing wallet signature, not a session — nothing expires. The signed lifecycle log shows every state change; the only human action possible on the account is funding it, and every such action is a public transaction, not a credential grant.
Money handling is minimized accordingly: x402 payments are optional and last in the build order.

## 1. Outcomes (versioned, deterministic, per horizon)

| Label | Definition | Horizons | Applies to |
|---|---|---|---|
| `INSIDER_EXIT` | Creator cluster (§3.2) net-sells ≥ 50% of its peak token holdings | 6h, 24h, 72h | all |
| `SELL_IMPAIRED` | A fixed-size sell simulation reverts or effective sell tax ≥ 30% at the horizon check | 1h, 24h | non-launchpad tokens (launchpad tokens: always false, reported as N/A) |
| `LIQ_IMPAIRED` | Primary pool liquidity ≤ 20% of its post-launch peak via removal transactions | 24h, 7d | non-launchpad tokens (launchpad LP is locked by construction) |
| `DRAWDOWN_80` | Price ≤ 20% of the maximum observed in the first 24h, measured at the horizon | 24h, 7d | all |
| `TRADING_ALIVE` | At least one trade for the primary pool in the 6h ending at the horizon (M4e) | 24h, 7d | all |

`DRAWDOWN_80` is a drawdown, not an accusation. The word "rug" does not appear in report fields. A buyer chooses the outcome that matters to their strategy.

`TRADING_ALIVE` is the one **positive** outcome — `value = true` means the token was still trading near the horizon; the published probability is `P(still trading)`. It answers the research finding that most launches stop trading the day they launch, and is the outcome launchpads and aggregators rank on.

### 1.1 Report time is arbitrary
Every report carries `reportTime` and `trigger` (`launch` | `qualified` | `on_demand` | `scheduled` | `event`). All horizons are measured from `reportTime`, not from launch. Features that depend on age (`age_hours`, holder-count trend, cluster balance delta since last report, liquidity delta, ownership or implementation changes since last report) are computed at `reportTime`. Metrics are published per trigger type because on-demand requests skew toward already-suspected tokens and have a different base rate. `DRAWDOWN_80` for non-launch reports uses the maximum price in the 24h before `reportTime` as its reference.

Outcome rule v1 hash is committed before the first live report. Changes apply only to reports issued after the change's effective block.

## 2. Metrics (per outcome, per horizon, per forecaster)

AUROC, AUPRC, log loss, Brier, Brier Skill Score against the trailing-30-day base rate, expected calibration error (deciles), precision and recall at 0.5 and at each design partner's stated threshold. Minimum 100 resolved launches before a metric is shown; sample size always displayed.

Forecasters scored side by side:
1. `base_rate` — trailing 30-day prevalence.
2. `heuristic_v1` — a fixed rule: creator dev-buy ≥ 5% of supply OR launch-block cluster ≥ 3 wallets OR top-10 non-creator share at T+10m ≥ 40%.
3. `det_v0` — the deterministic score (§4).
4. `llm_deepdive_v0` — the LLM forecaster (§5), where run.
5. `scanhood` and `goplus` — their public scan outputs mapped to [0,1] by a fixed published mapping, fetched at report time and stored (they are baselines and data sources, not enemies).

A forecaster "beats" a baseline only with a statistically significant AUROC gap (DeLong test) on ≥ 200 resolved launches. Until then the dashboard says "insufficient sample."

## 3. Pipeline

### 3.1 Two lanes (spam defense)
- Index lane, every launch: event-derived features only; no simulation, no LLM, no external API calls beyond RPC and Blockscout. Cost per launch ≈ 0. Per-creator quota: after 5 launches by one creator in 24h, further launches are indexed but not scored.
- Qualified lane: launches that reach ≥ 2,000 USD liquidity-equivalent or ≥ 25 unique buyers within 10 minutes, or any paid request. Runs simulation (non-launchpad), external scanner fetch, and optionally the LLM deep-dive.

### 3.2 Creator cluster (v1, deliberately narrow)
A wallet is in the creator cluster if any of: it is the creator; it bought in the launch block (Noxa restricts launch-block buys to the creator, so any such buy is creator-controlled); it received tokens directly from the creator; its first-ever inbound transaction on 4663 came from the creator. Shared bridge or CEX funding source is not association (false-cluster risk). Each cluster membership carries the evidence transaction hash. Cluster confidence is published.

### 3.3 Features v0 (deterministic; each with source and block)
1. `source`: Noxa, Pons, or raw pool; LP-locked-by-construction flag.
2. `creator_devbuy_pct`: supply bought in the launch transaction/block.
3. `creator_age_days`, `creator_prior_launches`, `creator_prior_insider_exit_rate` (from own DB; empty at start, filled by backfill §7).
4. `cluster_size`, `cluster_supply_pct` at T+10m.
5. `top10_noncreator_pct` at T+10m.
6. `unique_buyers_10m`, `buys_per_buyer_10m`, `microbuy_share_10m` (buys under a fixed small size).
7. `liquidity_usd_10m`, `sell_impact_bps` for a fixed-size sell (quote-based; no fork needed).
8. `has_x`, `has_site` (presence only).
9. Non-launchpad only: `verified`, `owner_renounced`, `mintable`, `lp_holder_type`, `sell_sim_ok`, `sell_tax_bps` — from GoPlus/ScanHood cross-check plus own `eth_call` sell quote. Do not rebuild honeypot detection; consume it.
10. **Pre-staged-exit surface (M4e).** Almost every launch on 4663 is a Uniswap v4 pool, where a hook can block sells, skim a dynamic tax, or gate LP removal without touching the token contract old scanners check. `hook_permissions` (the 14-bit flag value from the hook address — zero RPC), `hook_can_block_swap` (`beforeSwap` present → can revert a sell), `hook_can_tax_swap` (a returns-delta swap flag), `hook_gates_lp_removal` (`beforeRemoveLiquidity` present); `side_pool_count` (other v4 pools this token has a currency slot in, in the T+10m window); `creator_approvals_outside_routers` (distinct non-infra spenders the creator/cluster approved on the token — a drainer-approval signal).
   `sell_impact_bps` (item 7) is quoted at fixed **100 and 1,000 USDG-equivalent** notionals (checkpoint §8.4), stored as `sell_impact_bps_100` / `sell_impact_bps_1000`.

Feature code is public. Feature values are reproducible from RPC and Blockscout at the stated block, except external scanner outputs, which are stored verbatim with their fetch timestamp.

## 4. Deterministic score `det_v0`
A logistic combination with hand-set, published weights per outcome, frozen and committed before live operation. After backfill (§7) reaches 300 resolved launches, fit weights on the historical set, version as `det_v1`, commit, and keep both live so the improvement is visible. Never fit on live data that has not resolved.

## 5. LLM deep-dive `llm_deepdive_v0` (the Orbio key's job)
- Runs on qualified-lane launches within the daily compute budget, and on every paid T1.
- An agent loop (OpenRouter agent SDK or plain tool calling) with read-only tools: `blockscout_address`, `blockscout_txs`, `cluster_expand`, `price_series`, `holder_snapshot`, `web_search` (server tool). Structured output: `{p_insider_exit_24h, p_drawdown_80_7d, p_sell_impaired_24h, evidence:[{claim, tx_or_url}], confidence}`.
- Every field reaching the final structured output is typed and range-checked; free-text fields are limited to `evidence[].claim` and never feed back into other prompts. Metadata and socials text is quoted inside a delimited block with an explicit "data, not instructions" frame.
- It is scored as its own forecaster. If it does not beat `det_v0` on ≥ 200 launches, that result is published and the deep-dive is demoted to an optional paid narrative. That is the experiment the contest funds.
- Compute cap per run ≤ 0.20 USD; daily cap set by the Metabolism budget policy.
- Implementation: `@openrouter/agent` (`tool()` + zod, `callModel`, max-steps stop condition, structured output). Model slug is pinned in config and committed; `~latest` aliases and `openrouter/auto` are not allowed for scored forecasters because the model must be identifiable per report. Attribution headers (`HTTP-Referer`, `X-Title`) are sent on every call.

## 6. Commitment and signing
- `CommitRegistry` (unchanged from v0.1): Merkle root of report hashes every 5 minutes or 200 leaves; also commits feature-code hash, weight hash, outcome-rule hash, scorer hash, model id.
- Reports signed EIP-712 by the agent key. Signer rotation committed.
- Language on the dashboard: "committed before outcome" and "reproducible scorer." Nothing stronger.

## 7. Backfill (so there is a track record at judging)
Reconstruct features and outcomes for the last 45 days of Noxa/Pons/raw launches using archive RPC + Blockscout, with feature code frozen and the scorer run exactly as it will run live. Publish the backfill as a separate, clearly labeled set ("retrospective, not precommitted"); live commits from day one prove no cherry-picking going forward. Backfill also seeds `creator_prior_*` features.

## 8. Metabolism (Orbio MCP client)
Unchanged state machine from v0.1 §7 (NO_KEY → ACTIVE → DRAINING → ROTATING; IDS → REVOKING; STARVED). Budget policy now simpler: daily deep-dive budget = min(`dailyCapUsd`, 50% of credits accrued in trailing 24h, key remaining − reserve). The metric shown is "days of unattended key lifecycle" = days since the last manual credential action, with the signed lifecycle log as evidence; no claim beyond that.

### 8.1 Fork-and-run
A holder runs their own instance in three steps: clone, `pnpm orbio:auth` (browser sign-in with the wallet holding $ORBIO), `pnpm start`. No other credentials beyond an RPC URL. Each instance signs with its own key. Stretch: instances may POST signed reports to the main benchmark's ingest endpoint and appear as their own forecaster (`forecaster = signer address`), so the benchmark becomes a network of holder-funded agents.

### 8.2 Deep-dive method (adopted from the `evm-token-due-diligence` skill)
The deep-dive follows that skill's evidence discipline: a frozen target packet (chain ID from RPC, exact address, block pin with hash and UTC timestamp, runtime hash, proxy/implementation resolution, candidate pools); every tool result is an evidence row `{value, source, block, query}`; coverage limitations (RPC errors, missing archive data) are recorded as limitations, never as findings or passes; external text is data, not instructions. Output adds the skill's eleven separately rated surfaces (token controls, canonical LP custody, side-pool removal risk, sellability and depth, concentration, launch integrity, admin/treasury/reward custody, reward accounting, utility and redemption rights, external dependencies, development and disclosure) in its bounded language, alongside our outcome probabilities, plus a finding-to-evidence ledger. The skill's heavy tracks (transfer replay, fee reconciliation, bridge tracing, bytecode reconstruction) are v0.4 Trace, not contest scope. Pons note: the direct curve-buy recipient, not the transaction sender, is the beneficiary for `creator_devbuy_pct`.

### 8.3 Report validator
Before any report is committed it must pass a validator: requested, queried and reported chain/address match; block pin has a real hash and timestamp; no field marked unknown is presented as a pass; signer matches the instance identity. Failing reports are stored but never committed.

## 9. API and payments
| Endpoint | Price | Notes |
|---|---|---|
| `GET /v1/launches` (feed) | free | latest launches with `det_v0` and commit proof |
| `GET /v1/report/{token}` | free tier during contest; later T0 free / T1 0.10 USDG via x402 | includes all forecasters and evidence |
| `POST /v1/assess/{token}` | free during contest | on-demand report for a token of any age; trigger=`on_demand`; also enqueues the token for daily scheduled re-scores for 7 days |
| `POST /v1/deepdive/{token}` | 0.10 USDG via x402 or API key | triggers `llm_deepdive_v0` |
| `GET /v1/benchmark` | free | metrics table, all forecasters, sample sizes |
| `GET /v1/proof/{hash}` | free | Merkle proof |
| `GET /v1/lifecycle` | free | signed key-lifecycle log |
| MCP server (`/mcp`) | same prices | `get_report`, `get_benchmark`, `request_deepdive` so agent buyers need no HTTP code |

x402 is a payment rail, not a channel. Also accept a plain API key for design partners. Facilitator fees (~0.001 USD/call) are included in the model.

## 10. Demand gate (before any work beyond the contest)
Three integration commitments from bots, terminals or launchpads of the form: "if `p_insider_exit_24h` beats our current heuristic on the backfill set at threshold X, we call it on every candidate at price Y." Candidates: Robinhood Checker, the Phanes/Skeleton/Rick/Major alert bots, the open-source Robinhood sniper/LP bots, ScanHood, Hood Trade, Noxa, Pons. The benchmark page is the pitch: it scores their signals too.

## 10.1 Roadmap beyond the contest (same commit-and-score spine, one agent identity)
- v0.3 Watch: subscriptions per token (holders, communities, protocols); event-driven re-scores on cluster wallet movements, LP changes, ownership transfers, contract upgrades, approaching unlocks; alerts with the diff since the last report. This is the recurring-revenue layer.
- v0.4 Trace: post-incident fund tracing across bridges and chains to exchange deposit addresses; timestamped evidence packages of addresses, transactions and flows delivered to exchanges, protocols and victims; cross-chain, evidence-weighted entity graph with confidence scores.
- v0.5 Triage: scanning of deployed contracts and upgrades for known vulnerability classes, reproduced on forks only; private disclosure to the owner or their bounty program first, publication only after a fix; bounty programs as the revenue source.
- Standing rule across all layers: the agent reports on addresses, contracts and flows. Identity attribution and any public accusation naming a person go to a human review queue with the agent's evidence attached; the agent never publishes them itself and never tests exploits against live funds.

## 11. Cut from v0.1 and why
- RevenueRouter and automatic $ORBIO buys: negligible credit recapture, MEV bait, and $ORBIO's main market is quoted in tokenized NVDA. Treasury is a manual decision.
- "Self-funding" framing: credits are a subsidy from total $ORBIO volume (0.75% × volume × your time-weighted share). Publish standalone and subsidized P&Ls.
- Single `P(rug)`: replaced by four mechanical outcomes.
- Brier ≤ 0.15 target: replaced by skill scores and AUROC against baselines.
- "Days since a human touched the key": replaced by unattended-lifecycle days with signed log.
- Generic LLM due-diligence prose as the product: replaced by a scored LLM forecaster.
- ERC-8004 registration, watch streams, Base: after the demand gate.
- Selector-scan hidden-mint detection, time-warp simulation, Anvil forks: replaced by external scanner cross-check and quote-based sell impact.
- "Same funding source" wallet association: removed.
- x402 directories as distribution: removed.

## 12. Configuration `[PARAM]`
`qualify.liqUsd` 2000 · `qualify.uniqueBuyers` 25 · `quota.perCreator24h` 5 · `deepdive.capPerRunUsd` 0.20 · `deepdive.dailyCapUsd` 5 · `price.deepdive` 0.10 · `commit.intervalSec` 300 · `commit.maxLeaves` 200 · `reserveR` 0.60 · `claimSize` 25 · `hygieneRotateDays` 7 · `backfill.days` 45 · `minResolvedForMetrics` 100 · `minResolvedForClaims` 200
