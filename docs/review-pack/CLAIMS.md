> **Superseded.** Frozen snapshot of 2026-09-15 (`d61dc20`), the target of the first Codex review. Many claims below were withdrawn or reworded on 16–19 Sep. The current inventory is [`docs/CLAIMS.md`](../CLAIMS.md).

# Claims under test

Every public claim the project makes, one per line, **verbatim**, with its source.
Treat each as a hypothesis. Template placeholders are shown as `{…}`; conditional
text (only rendered in some states) is marked *(conditional)*.

Snapshot: repo `main` @ `d61dc20`, 2026-09-15.

**Sources that do not exist yet:** `DEMO.md` has not been written (milestone M10).
The 200-word summary exists only as a draft inside the field report (§10), so it is
included below from there. When DEMO.md is written its claims must be added here.

---

## A. Dashboard — `apps/web/public/index.html`, `apps/web/public/app.js`

Live at the dashboard URL in `LIVE.md`.

- A1 · `index.html:19` — "Precommitted exit-risk oracle · Robinhood Chain (4663)"
- A2 · `index.html:34` (Metabolism panel) — "The agent's own Orbio key lifecycle — spec §0.1: zero-billing compute, credit-driven throughput, unattended continuity."
- A3 · `index.html:50` (P&L panel) — "The Orbio-specific test (spec §0.1): would this run the same on a plain OpenRouter account with no token?"
- A4 · `index.html:65` (Live launches) — "Latest non-retrospective launches with the det_v0 forecast and its commit proof."
- A5 · `index.html:83` (Benchmark) — "AUROC / Brier Skill vs. baselines, per outcome · horizon · forecaster."
- A6 · `index.html:83` — "Minimum {100} resolved to show a metric, {200} (with ≥30 positives) to claim a beat."
- A7 · `index.html:83` — "\"+N retro\" = backfill launches folded into the all-inclusive column beyond what live traffic alone has resolved."
- A8 · `index.html:90` (Key lifecycle) — "The signed lifecycle_log chain — every row's bodyHash folds the previous row's, so tampering is detectable, not just promised."
- A9 · `index.html:102` (footer) — "Committed before outcome · reproducible scorer. Nothing stronger claimed."
- A10 · `app.js:20,22` (benchmark badge tooltip on SELL_IMPAIRED@1h / @24h) — "Fixed $100 sell against pools of ~$1k median depth — measures liquidity depth, not deception. Not treated as a forecastable claim."
- A11 · `app.js:139` (metric) — "Credits accrued" — "{$x}/hr" — "over {N}h of samples"
- A12 · `app.js:140` (metric) — "Spend per report" — "{N} requests, trailing 24h"
- A13 · `app.js:152` *(conditional)* — "Gate closed — billing status is anomaly or phantom."
- A14 · `app.js:153` *(conditional)* — "Balance last confirmed {age} — the Orbio MCP session bounds key management, not spending, so research continues under the daily cap and the local ledger."
- A15 · `app.js:160-162` (Unattended continuity card) — "chain verified" / "starts at genesis" / "log span held {N} days ({N} rows)"
- A16 · `app.js:163` — "Without a working OAuth refresh grant, unattended continuity is bounded by the access token's own lifetime, not by this log's span — see CHANGELOG.md. This number describes what the signed log currently covers, not a guarantee of what comes next."
- A17 · `app.js:176,184` — "revenue (free during contest)" — "$0.00"
- A18 · `app.js:177` (Standalone box) — "compute, cash-priced" — "{max(provider spend, estimated spend), trailing 24h}"
- A19 · `app.js:178` — "What the trailing-24h LLM deep-dives would have cost on a plain OpenRouter account with no Orbio credits — the standing red-team check from spec §0.1."
- A20 · `app.js:183,185` (Orbio-subsidized box) — "$0.00" — "cash spent" — "$0.00"
- A21 · `app.js:186` — "Same compute, actually run: {N} requests in the trailing 24h, paid entirely from the agent's Orbio-funded key. The agent never held or converted money to make this happen."
- A22 · `app.js:195` (proof column) — a "tx ↗" link to the Blockscout commit transaction for each committed launch
- A23 · `app.js:261` *(conditional)* — "beats {baseline} p={p}"
- A24 · `app.js:1-4` (source comment, not rendered, but it is the dashboard's stated contract) — "Every number here either comes straight off an api response or is a transparently-labelled derivation from one (credits/hr, spend/report, rotation counts); nothing is invented when data is missing — those cases render \"n/a\" or an explicit note instead."

## B. Telegram free feed — `apps/worker/src/telegram/poster.ts:75-92`

Channel in `LIVE.md`. Posted once per qualified-lane `det_v0` report after it has a commit.

- B1 — "New qualified launch: {token}"
- B2 — "P(insider exit, 24h): {p}%"
- B3 — "P(drawdown ≥80%, 24h): {p}%"
- B4 — "P(still trading, 24h): {p}%"
- B5 *(conditional — only when `PUBLIC_API_BASE_URL` is set; it is **not** set in production as of this snapshot)* — "Verify this forecast: {apiBase}/v1/proof/{reportHash}"
- B6 — "Batch anchor (many reports, one Merkle root): {explorer}/tx/{txHash}"
- B7 — "Report hash: {reportHash}"
- B8 — "committed before outcome · reproducible scorer"

Also posted to the **same public channel** (because `TELEGRAM_ALERTS_CHANNEL_ID` is unset), from `apps/worker/src/alerts.ts`: operational alerts such as "commit lag: {N}min since the last commit batch (threshold 10min)" and "✅ recovered — {check}: {detail}". Not claims, but part of the public surface.

## C. 200-word submission summary (draft) — `field-report-2026-09-11.md` §10

Numbers in C9 are dated 11 Sep 2026.

- C1 — "Launch Auditor watches every new token on Robinhood Chain, computes deterministic manipulation and exit-risk features within seconds, and publishes separate probabilities for five mechanically defined outcomes — insider exit, sell impairment, liquidity impairment, 80% drawdown, still trading — at fixed horizons."
- C2 — "Every forecast is signed and its hash committed on-chain before the outcome can be known; an open-source scorer later grades it against chain data and against public baselines, including the existing scanners' own verdicts."
- C3 — "The product is not the warning but the track record."
- C4 — "The agent runs on an Orbio key it minted itself: it polls its balance every minute, sizes its daily research budget from credits accrued in the last 24 hours, and writes every state change to a signed lifecycle log — it never holds or converts money."
- C5 — "Anyone holding $ORBIO can clone the repo, authorize once, and run their own instance."
- C6 — "What is measured so far: 1,608 launches indexed, 4,463 signed forecasts, 963 outcomes graded, two of eleven cells with base rates; of qualified launches, 27% are still trading after 24 hours."
- C7 — "What is not yet proven: the LLM forecaster has no grades, most cells are thin, and the live precommitted record is days old."
- C8 — "Registry: 0xF36F…BEe."

## D. Repository README — `README.md` (becomes public at M10)

- D1 · `README.md:3-7` — "Precommitted exit-risk oracle for Robinhood Chain (chain 4663). For every new token launch it computes deterministic manipulation / exit-risk features within seconds, publishes probabilities for four mechanically-defined outcomes, signs and commits the forecast on-chain **before** the outcome can be known, and later grades every forecast with an open-source scorer against those outcomes and against public baselines."
- D2 · `README.md:9-10` — "What it claims: the forecast existed before the outcome; the scorer is reproducible; the baseline comparison is public."
- D3 · `README.md:158-160` — "anyone holding $ORBIO can clone this repo, authorize once, and run their own instance — with **no card, no top-up, no payment rail**."
- D4 · `README.md:173` — "one-time browser sign-in — the ONLY interactive step, ever"
- D5 · `README.md:180-184` — "`pnpm start` runs the watcher, the metabolism lifecycle loop, the commit loop, the outcome resolver, the deep-dive worker, the free-feed Telegram poster, a periodic benchmark snapshot, the API, and the dashboard — all from one command"
- D6 · `README.md:184-186` — "From here the agent mints and manages its own Orbio gateway key without further human input; see Metabolism below for what \"without further human input\" is currently bounded by."
- D7 · `README.md:89-91` — "`GET /v1/lifecycle?limit=200` (spec §9, free) returns the rows oldest→newest with a server-side `verified` boolean; the rows are also independently verifiable offline."
- D8 · `README.md:202` — "`GET /v1/proof/:hash` | A report's Merkle proof, verified locally, plus a best-effort on-chain confirmation of its batch root (an RPC hiccup reports `onChainConfirmed: null`, never `false`)."
- D9 · `README.md:221-223` — "standalone (what the same compute would have cost on a plain OpenRouter account — the spec §0.1 red-team question, answered in dollars) and Orbio-subsidized (what was actually spent: $0 cash)."
- D10 · `README.md:231-233` — "No number here is invented: everything is either a raw API field or a labelled derivation"
- D11 · `README.md:238-240` — "stamps the report's `telegramPostedAt` so a restart never double-posts."
- D12 · `README.md:327-328` — "Runs `prisma generate` + `prisma validate` + `tsc --noEmit` for every package + the vitest suites, and prints a green summary. No Docker, no network, no paid APIs."

## E. The spec's own headline claims — `launch-auditor-spec-v0.2.md`

- E1 · §0 — "What it claims: the forecast existed before the outcome; the scorer is reproducible; the comparison to baselines is public."
- E2 · §0 — "The agent claims, monitors, rotates and revokes its own OpenRouter key through the Orbio MCP."
- E3 · §0 — "An LLM deep-dive, paid for with the agent's Orbio-funded key, runs on qualified launches and is scored as a separate forecaster so the dashboard shows whether the model adds discrimination over the heuristics."
- E4 · §0.1 property 1 — "Zero-billing compute: any holder clones the repo, authorizes the MCP, and runs an instance with no card, top-up or payment rail (fork-and-run, §8.1)."
- E5 · §0.1 property 2 — "Credit-driven behavior: the daily deep-dive budget is a function of credits accrued in the trailing 24h; throughput visibly follows token activity and holdings, and the agent never holds or converts money to make that happen."
- E6 · §0.1 property 3 — "Unattended continuity: keys drain, rotate at the next accrual, and the signed lifecycle log shows it."
- E7 · §0.1 — "The demo therefore hinges on three properties only Orbio provides, and the dashboard leads with them"

---

## Explicit non-claims

The project states it does **not** claim these. A judge should check that nothing
above contradicts them.

- N1 · spec §0 — "What it does not claim: that it pays for itself, that no human touched the server, or that the analysis is correct because it is committed."
- N2 · `README.md:10-11` — "What it does **not** claim: that it pays for itself, that no human touched the server, or that a forecast is correct because it was committed."
- N3 · `index.html:102` — "Nothing stronger claimed."
- N4 · field report §04 — "That it pays for itself. That no human touched the server. That its analysis is right."
- N5 · field report §04 — "Committing a forecast says nothing about its quality. It proves the forecast existed beforehand. That's all."
- N6 · `app.js:20` — SELL_IMPAIRED is "Not treated as a forecastable claim."
- N7 · spec §0.1 — "The screener, commits and benchmark fail this test on their own; they are the work, not the proof."
