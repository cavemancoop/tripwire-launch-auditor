# Claims inventory — 19 Sep baseline and 29 Sep addendum

The tables below preserve the public claims checked on 19 Sep, quoted from
their sources at that time. The dated addendum at the end covers current
sample-selection and marketing wording; do not treat this baseline as an
exhaustive inventory of today's live copy. This file replaces
`docs/review-pack/CLAIMS.md`, the frozen 15 Sep snapshot that the first Codex
review tested. That file is kept as a dated record.

**Baseline:** deployed commit `0df3f67`, checked logged out on 2026-09-19 at
about 09:30 UTC. Two lines, **A10** and **A11**, changed in the commit that
added this file; they're marked "ships with this commit" until observed.

**Evidence types:**
- **prod-observed**: seen on the deployed service without authentication.
- **verified-offline**: recomputed by `pnpm verify:receipt` or the test suite.
- **source-only**: true of the code, but no single public observation shows it.

## A. Dashboard — `apps/web/public/index.html`, `app.js`

| ID | Claim (verbatim) | Evidence |
|---|---|---|
| A1 | "Precommitted exit-risk forecasts · Robinhood Chain (4663)" (tagline) | prod-observed |
| A2 | "Tripwire scores new token launches on Robinhood Chain for five ways they can go wrong, signs each forecast and commits it on-chain minutes after launch, then grades itself in public against what actually happened — including where it's wrong. The scores rank launches; they are not calibrated probabilities." (hero) | prod-observed. Commit lag on the feed is 0–6 min after the T+10m anchor, so "minutes after launch" means ~10–16 min. |
| A3 | Panel 00: "Everything below comes from this forecast's receipt, and you can check it yourself without trusting this server." | verified-offline: `pnpm verify:receipt 0xbe1e685a…c7e915`, all checks PASS through a public RPC. |
| A4 | Panel 00: "An insider exit did happen, and det_v0 scored it 0.996. That's one example of the mechanism, not evidence of skill … picked from 113 completed, fully eligible forecasts in the 12–16 Sep feed archive" | prod-observed (receipt); the 113 comes from scanning 614 public feed posts (CHANGELOG, Tier 2 fixes 4+6). |
| A5 | Panel 03: "The scores rank launches, and only on the two outcomes where the benchmark shows they beat the base rate; they are not calibrated probabilities. Drawdown isn't shown because det_v0 ranks it backwards." | prod-observed: benchmark shows claims on INSIDER_EXIT@24h and TRADING_ALIVE@24h, and "ranks backwards" on DRAWDOWN_80@24h. |
| A6 | Panel 04 callout: "Scored rows are live forecasts whose commit landed on-chain (by block time) within 30 minutes of the report's T+10m anchor and before the outcome's horizon ended. Late commits, outage replays and uncommitted reports are excluded and counted under each outcome. No backfilled rows." | prod-observed (`live.exclusions`, coverage `retrospectiveResolved` = 0). verified-offline: `eligibility.test.ts`, `collect-eligibility.test.ts`. |
| A7 | Panel 04: "Minimum 100 resolved to show a metric, 200 (with ≥30 positives) to claim a beat." | prod-observed: the n=79 LLM cell shows n/a. verified-offline: paired-positive gate test. |
| A8 | Panel 04: "The resolver does not keep up with every forecast, so graded rows are not a random sample" | prod-observed (policy line, pending counts). |
| A9 | Budget card: "Computed with the worker's own gate and spend window. The cap follows on-chain CREDIT: at most half of what was activated into the agent's account in the trailing 24h." | source-only + verified-offline: the display calls `deepdiveRunGate`; audit counterexample test. |
| A10 | Panel 05: "each row's bodyHash folds its parent's, so altering or deleting a row is detectable, not just promised. Forks (two rows naming one parent) are shown, not hidden." | **ships with this commit.** prod-observed at `0df3f67`: "intact, 2 forks". |
| A11 | Footer: "Counted forecasts were committed before their outcome window closed · reproducible scorer · scores rank launches, they are not calibrated probabilities. Nothing stronger claimed." | **ships with this commit.** |
| A12 | Funding note: "The worker's code only ever activates the CREDIT the agent holds … That's an application check, not a restriction on the wallet itself — whoever holds the wallet key could sign anything." | source-only (`credit-wallet.ts` allowlist + tests). |
| A13 | Continuity note: "The agent's API key is a signature from its own wallet, so no sign-in expires. This describes what the signed log currently covers, not a guarantee of what comes next." | prod-observed. The card also shows "longest gap between rows: 13.7 h" (the 18 Sep outage). |

## B. Telegram feed — `apps/worker/src/telegram/poster.ts`

| ID | Claim (template) | Evidence |
|---|---|---|
| B1 | "Insider exit within 24h: {top 10% riskiest \| top 25% riskiest \| middle half \| bottom 25% (least risky)}" | prod-observed: 20/20 visible posts, spread across all four tiers |
| B2 | "Still trading at 24h: {top 10% most likely \| … \| bottom 25% (least likely)}" | prod-observed |
| B3 | "Ranked against the {n} qualified launches in the previous 24h." | prod-observed (n = 813–814) |
| B4 | "Ranking only: these scores are not calibrated probabilities. Benchmark: {api}/v1/benchmark" | prod-observed |
| B5 | "Verify this forecast: {api}/v1/receipt/{reportHash}" | prod-observed on 15 of 20 visible posts (every post since the change) |
| B6 | "Committed {n} min after its T+10m anchor · reproducible scorer" | prod-observed (0–6 min). Posts with a lag over 30 min are never sent (`isFresh`). |

## C. README — intro and 200-word summary

| ID | Claim (verbatim) | Evidence |
|---|---|---|
| C1 | "A counted forecast was committed on-chain within 30 minutes of its anchor and before its outcome window closed. Forecasts committed later are excluded from every claim and counted separately" | prod-observed (as A6) |
| C2 | "Any single forecast can be checked without trusting this server: `pnpm verify:receipt <reportHash>`" | verified-offline against production, two receipts (one eligible, one outage replay) |
| C3 | "Since 16 Sep, the agent's compute has been funded by CREDIT activated into its own on-chain account, each activation a public transaction" | prod-observed (`/v1/funding`: #58, #79, #164, #211) |
| C4 | Summary: "a rule added when outage replays committed hours late turned up in 22% of scored rows" | prod-observed: census, `DECISIONS.md` 2026-09-19 |
| C5 | Summary: "On the rows that count, the model beats both base rates at ranking insider exit and whether a token is still trading. It ranks drawdown and liquidity loss backwards, where an existing scanner does better. The LLM deep-dive shows no added discrimination yet." | prod-observed (benchmark) |
| C6 | Summary: "Its API key is a wallet signature, so there is no session to expire. The operator funds it; each activation is public." | source-only (key derivation) + prod-observed (funding) |
| C7 | Fork-and-run: "anyone holding $ORBIO can clone this repo, point it at a wallet holding CREDIT (earned by staking ORBIO), and run their own instance" | **Public source:** github.com/cavemancoop/tripwire-launch-auditor-public (anonymous HTTP 200, one clean commit, code byte-identical to the deployed tree). An anonymous clone + `pnpm install` + `pnpm verify:receipt` passes. Running a full instance with its own CREDIT wallet has not been independently demonstrated. |

## D. `DEMO.md`

Its figures are the ones in A–C, taken from production at `0df3f67`. Its
headline claims are the panel 00 example (A3/A4), the eligible-record table
(A5–A8), the funding and budget description (A9, A12, C3), and "What broke
this week" (CHANGELOG entries dated 2026-09-18/19).

## E. Spec — `launch-auditor-spec-v0.2.md` §0, §0.1 (amended 2026-09-19)

| ID | Claim | Evidence |
|---|---|---|
| E1 | "What it claims: every counted forecast was committed on-chain before its outcome window closed (and within 30 minutes of its anchor; later ones are excluded and counted)" | as A6 |
| E2 | §0.1.2: "the daily deep-dive budget is spent from CREDIT activated into the agent's own on-chain account … `min(dailyCap, 50% of CREDIT activated into the account in the trailing 24h, balance)`" | as A9 |
| E3 | §0.1.3: "the key is a standing wallet signature, not a session, so there is no login to lapse; the agent still depends on its RPC provider, funding, gas and the operator-held wallet key" | source-only. The 18 Sep outage is the dependency showing. |

## Explicit non-claims

- The scores are not calibrated probabilities. `det_v0`'s Brier Skill is
  negative on every cell (prod-observed).
- It does not pay for itself. The operator funds it with CREDIT (prod-observed).
- Committing a forecast doesn't make it right. Three cells rank backwards
  (prod-observed).
- The LLM deep-dive has not been shown to add discrimination (prod-observed,
  n=446, AUROC 0.458).
- Graded rows are not a random sample of forecasts (A8).

## Known open items at this baseline

- The lifecycle runner had a 13.7 h gap (18 Sep outage) and 2 forks
  (18–19 Sep deploys, since prevented).

## 2026-09-29 current marketing and sample-selection addendum

The table above is the frozen 19 Sep baseline. Its A5 and C5 wording is not a
current population-performance claim. The live resolver works oldest due
rows first within each label, so the resolved, commit-eligible benchmark is a
selected older subset. The public dashboard discloses the backlog and warns
that graded rows are not a random sample. The live benchmark may show pooled
ranking gains on resolved rows, but that does not establish performance across
new launches. It is a result for the rows already graded.

| Surface | Current treatment | Remaining check |
|---|---|---|
| README external-submission summary | Says benchmark gains are in a selected, resolved sample and discloses the older backlog; does not call scores calibrated probabilities or claim self-funding. | Recheck any copied submission text before reuse. |
| Public dashboard launch panel and benchmark | Launch panel qualifies the two displayed ranking claims; benchmark shows the non-random backlog warning before pooled metrics and labels current-lane comparisons diagnostic. | Observe served HTML after release and keep the warning next to future performance claims. |
| `DEMO.md` | Dated figures and a separate explicit non-random-sample warning. | Refresh figures before a new live demonstration; do not present the 19 Sep snapshot as current. |

This addendum does not change the benchmark scorer, eligibility gates or the
underlying outcome policy. Claims about the **population** need a prospective
cohort-completeness and quality result, not a larger selected resolved sample.

## 2026-09-29 outcome-boundary and funding-goal addendum

The current resolver's `blockAtTime` helper searches from block 1 to chain
head but stops after 18 midpoint probes, even if the interval has not
converged. On a chain much taller than 262,144 blocks, it can return an early
block and cache it. The [public feed](https://api-production-6a84.up.railway.app/v1/launches?limit=1)
was above 75 million blocks on 29 Sep. An offline high-height replay reproduced
early results; the precise number of affected production labels, elapsed-time
shift and benchmark impact have **not** been measured. Until corrected and
validated, interpret outcome-window boundaries with this limitation. This
addendum neither rewrites old labels nor changes the live resolver.

The baseline non-claim that Tripwire does not currently pay for itself remains
true. Self-funding is an intended business result: earned revenue should
cover continuing inference, data and infrastructure costs. Current CREDIT is
operator-funded, and no unit-economics result yet supports a self-funding
claim.
