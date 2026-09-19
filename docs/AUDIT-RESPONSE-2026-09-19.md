# Response to the independent readiness audit of 2026-09-19

For the auditor. This maps each finding in `docs/INDEPENDENT-AUDIT-2026-09-19.md`
to what changed, where, and how it was checked. It also lists what's still open.

**Final deployed commit:** `0b5bf3c` (api, worker and web all `SUCCESS` at 09:50:20Z). The sections below were first checked at `dfbbc70`.
**Evidence captured:** 2026-09-19 at 09:32 UTC, logged out, using `curl`
without auth, the public Telegram web preview, a fresh browser tab, and
`pnpm verify:receipt` over the public RPC `rpc.ordofi.network`.
**Audit baseline:** `b910ce9`. Everything since is on `main`.

We accepted every finding. We followed the audit's "explicitly leave alone"
list as written: no changes to weights, `det_v1`, outcome definitions, retro
imports, x402 or the film.

## Status by audit priority

| # | Finding | Status | Commits | How to check |
|---|---|---|---|---|
| 1 | Timeliness not enforced in the scorecard | **Fixed and observed** | `9c33b3d`, `101781b` | `curl $API/v1/benchmark \| jq .live.exclusions` |
| 2 | Repository returns 404 anonymously | **Open — owner action** | — | `curl -I https://github.com/cavemancoop/tripwire-launch-auditor` → 404 |
| 3 | Public proof doesn't bind the displayed forecast | **Fixed and observed** | `101781b`, `dce114f` | `pnpm verify:receipt <hash>` |
| 4 | Cold demo leads to uncommitted rows; no verified entry point | **Mostly fixed** | `1bb8023`, `2c4ccd6` | dashboard panel 00 |
| 5 | Contradictory benchmark claims and badges | **Fixed and observed** | `9c33b3d` | dashboard panel 04 |
| 6 | Orbio panel misstates the daily budget | **Fixed and observed** | `1bb8023` | dashboard panel 01 budget card |
| 7 | Surfaces tell different stories | **Fixed and observed** (except the film) | `2c4ccd6`, `0df3f67`, `dfbbc70` | `docs/CLAIMS.md` |
| 8 | Alerting / freshness / RU runway | **Partly** | `c8fc4d0` (ops) | see "Still open" |

## 1 — Timing eligibility (release blocker)

- **Rule.** Each report-outcome pair is classified by its commit's **chain
  block time**, never the DB's `committedAt`, which the audit found about 5 min
  late:
  - `eligible`: ≤ 30 min after the T+10m anchor and before the horizon ended;
  - `replay`: later, with the horizon still open;
  - `late`: at or after the horizon end;
  - `uncommitted`, `missing_time`.

  Only `eligible` pairs are scored.
- **How it's applied.** Base rates and scanners inherit `det_v0`'s class for
  the same observation, so every forecaster in a cell is scored on the same
  rows. Scanners also need their fetch within 30 min of the anchor. A late
  ScanHood fetch sees post-launch liquidity, which is hindsight in both the
  model's inputs and the scanner's baseline score. Every class is counted per
  cell in `benchmark.exclusions`.
- **Signed reports untouched.** `reportTime` and `trigger` are inside the
  committed bytes. "Replay" is a scoring-time class, not a rewritten trigger;
  this is one place we differ from the brief's wording.
- **Code.** The rule is in `packages/scoring/src/eligibility.ts`, used by the
  scorer (`apps/worker/src/scorer/collect.ts`) and by the per-report receipt,
  so both classify identically.
- **Tests.** `apps/worker/test/eligibility.test.ts` uses your replay token
  `0xafb2…e458` (late on 1h/6h, replay on 24h/72h/7d) and your timely samples
  (posts 3180, 3199: eligible). `collect-eligibility.test.ts` runs the
  collector over those fixtures.
- **Census**, observed at snapshot 2026-09-19T08:42:53Z (full table in
  `DECISIONS.md`):
  - 3,144 of 14,233 scored `det_v0` pairs (22%) were ineligible, and 608
    were committed after their horizon ended.
  - Of the three advertised wins, **two survive against both base rates**:
    INSIDER_EXIT@24h (AUROC 0.764) and TRADING_ALIVE@24h (0.652).
    INSIDER_EXIT@6h now beats only the constant floor.
  - ScanHood, with its late fetches excluded, beats both base rates and the
    heuristic on DRAWDOWN_80@24h (0.631) and LIQ_IMPAIRED@24h (0.586).
- **Independent reproduction of your replay, from public data:**
  `pnpm verify:receipt 0xdf34beac8367938bef62bc50dc893fdac66788a9fbb220af76a3216213cd178a`.
  Integrity checks pass; committed 41,805 s after the anchor; 1h/6h `late`,
  the rest `replay`.

## 3 — Report-specific proof

- **`GET /v1/receipt/:hash`** (`apps/api/src/receipt.ts`) serves:
  - the exact canonical bytes that were hashed;
  - the EIP-712 domain, types, message and signature;
  - the Merkle proof and root, the commit tx and block;
  - the block's **chain** timestamp and the lag from the anchor;
  - every outcome for the same anchor, with its eligibility class.
- **`pnpm verify:receipt <hash>`** (`apps/api/src/verify-receipt.ts`). The API
  is only a byte source; `--file receipt.json` works too. The tool:
  - recomputes `keccak256(bytes)`;
  - recovers the signer from a message rebuilt **from the bytes' own fields**,
    so a doctored `eip712.message` changes nothing;
  - folds the proof;
  - reads the commit **tx receipt**, requires `success`, the claimed block and
    a `BatchCommitted` log from the registry carrying the root (we avoided
    `eth_getLogs` because the public RPC refused every call);
  - reads the block timestamp and re-derives eligibility from it.

  Ten test cases cover tampered bytes, a doctored message, the wrong signer, a
  bad proof, a lying server label, and 400/404/200.
- **Observed:** receipt `0xd58bb77b…ffa5` (feed post, 19 Sep 08:41Z) passes
  all six checks, signer `0x6a5A…B4BE`, commit 304 s after the anchor.
- **Linked from the dashboard and feed.** The dashboard proof cell now links
  "receipt ↗" (and a secondary "batch tx ↗"), and feed posts say "Verify this
  forecast: …/v1/receipt/<hash>" (15 of 20 visible posts, every one since the
  change).

## 4 — Cold demo

- **Panel 00, "One forecast, checked end to end"**, renders a completed,
  eligible forecast live from its receipt: feed post 884, `0xbe1e685a…e7c915`.
  It shows what was forecast (insider exit 24h 0.996), when it was committed
  (block time, 330 s after the anchor), what happened (an insider exit did
  happen) and the verify command.
- **Labelled as an illustration.** It was picked from 113 completed, eligible
  forecasts found by scanning 614 public feed posts from 12–16 Sep.
- **Report backlog.** It drained by itself at 08:44Z. Report lag is now
  ~611 s and 1–2h coverage 98%. The Live launches note explains that the
  newest rows are always pending.
- **Not done:** chain-head-to-cursor lag and a report-age distribution on
  `/metrics`. We still reserve no capacity for current work during a replay
  (see "Still open").

## 5 — Benchmark page

- **One cohort.** The dashboard renders the `live` section, eligible rows only.
  The `+N retro` badge inferred from `all.n − live.n` is removed.
  Retrospective rows are counted from their own flag (currently 0 resolved).
- **Deterministic scanner anchor.** It's now the launch's *earliest*
  launch/qualified report. This was the likely cause of your live > all
  scanner anomaly: the old unordered iteration overwrote it.
- **Gates** (`packages/scoring/src/scorer.ts`):
  - the positives gate counts the **paired** rows (your 240/40 vs 205/5 case
    is a test);
  - below n=100 every metric and comparison is **withheld** (the LLM n=79 cell
    now shows n/a);
  - no "beats X" when the forecaster's own AUROC is ≤ 0.5 (the LIQ 0.366 badge
    is gone).
- **"Ranks backwards".** The badge fires when AUROC is significantly below 0.5
  (Hanley–McNeil z > 1.96) on a claim-sized sample.
- **Coverage.** Per-cell graded / pending / unresolvable / n/a counts, the
  exclusions by class, and a resolution-policy line stating that graded rows
  aren't a random sample.

## 6 — Budget display

- **One shared calculation.** `dailyDeepdiveBudget` and `deepdiveRunGate`
  moved verbatim to `packages/db/src/deepdive-budget.ts`. The worker
  re-exports them and the API's display calls them.
- **One spend window.** The display uses the worker's: the larger of the
  ledger and provider epochs since 00:00 UTC.
- **The card shows** the configured ceiling, today's effective cap and its
  binding term, spend since midnight, remaining, next-run max, the gate's own
  reason when closed, `balanceUnknown`, and `capSource`: `credit_linked`, or
  the disclosed `flat_fallback`.
- **Your counterexample is a test:** $0.90 spent gives $0.10 in both the
  display and the worker.
- **Observed:** effective cap $1.00, bound by the CREDIT share (2 CREDIT in
  24h); $0.99 remaining; $0.20 next run.
- **Custody wording.** Per your partial finding, it now says "the worker's code
  only ever activates … an application check, not a restriction on the wallet
  itself".

## 7 — Consistent surfaces

- **Removed or qualified everywhere:** "exact probabilities", "every new token
  launch", "within seconds", "oracle", "authorize once", "never holds or
  converts money", "the only human action possible", the unqualified
  "committed before outcome", and "every dollar of compute ever spent came
  from CREDIT" (untrue before 16 Sep). The surfaces covered are the dashboard
  hero, tagline and footer, the README intro and 200-word summary,
  fork-and-run, and spec §0/§0.1.
- **Feed** (decision A, `a2603e7`, observed): rank tiers on the two supported
  cells, no probabilities, drawdown dropped, a "ranking only" footer, the
  measured commit lag, and reports committed over 30 min after the anchor are
  never posted.
- **Live launches table:** `det_v0` shown as 0–1 scores labelled ranking-only;
  the drawdown column is removed.
- **`docs/CLAIMS.md`** is the current inventory: every claim quoted, with its
  evidence type. The 15 Sep file is marked superseded.
- **`DEMO.md`** was rewritten and walked through at `0df3f67`, in your
  recommended order: forecast, commit, outcome, eligible cohort, Orbio funding.

## Found during this work (not in the audit)

- **Chainstack quota outage, 18 Sep, ~13h.** Every chain call failed. Alerts
  fired at 2:44 AM local and nobody saw them. The plan was upgraded from 20M
  to 80M RU, and `RPC_BUDGET_RPM` cut from 3000 to 1000.
- **Lifecycle chain forks.** The dashboard read "BROKEN at 232". Two worker
  containers overlapping during deploys each appended onto the same parent
  (rows 230/231; 470). No row was altered.
  - Appends now run under a Postgres advisory lock with a head check; the
    loser re-chains.
  - The verifier reports forks separately from breaks, and `/v1/lifecycle`
    returns `verified` (intact), `linear` and `forks`.
  - Observed: "intact, 2 forks", with no new forks across the last two
    deploys.
  - The card also shows "longest gap between rows: 13.7 h", which is the
    outage.
- **Resolution bias, quantified.** None of 400 public feed posts from 17–18
  Sep had a single resolved outcome. The resolver works oldest first through
  a ~200k backlog.

## Follow-up after your second read (2026-09-19)

- **`/v1/launches` is paged.** Follow `nextCursor` via `?before=` until null to walk every live launch. The cursor is `(launchBlock, launchId)`, newest first. A test walks a corpus with ties inside blocks and gets each launch exactly once.
- **`COMMIT_REGISTRY_ADDRESS` is set on the API.** Receipts now carry `commit.registry`. This also re-enabled `/v1/proof`'s on-chain confirmation, which is why every proof you fetched said `onChainConfirmed: null`.
- **The backlog is stated up front.** The benchmark panel opens with "Graded so far: 17,407 of 267,069 outcomes whose horizon has passed (6.5%)". `DEMO.md` has a section on it: 239,609 due and ungraded, 640 graded in 24h, 11,760 recorded failures and their sources.
- **No model or feature work before judging**, per your advice.

## Rehearsal of the proof sequence (`0b5bf3c`, 2026-09-19 09:50Z, logged out)

1. **Panel 00 receipt, checked independently.** `pnpm verify:receipt 0xbe1e685a…e7c915` over the public RPC gave PASS on hash, signature (`0x6a5A…B4BE`), Merkle (6 siblings), on-chain root (tx `0xee1f992b…`, success, registry `0xF36F…BEe`), block 63282230 and block time 2026-09-15T01:52:17Z. That's 330 s after the anchor; INSIDER_EXIT@6h/24h are true and eligible. `/v1/proof` for the same hash: `proofValid: true, onChainConfirmed: true`.
2. **The eligible benchmark, failures included.**
   - Graded 17,423 of 267,115 due outcomes.
   - INSIDER_EXIT@24h: AUROC 0.767, beats both base rates (209 replays excluded).
   - TRADING_ALIVE@24h: 0.652, beats both base rates and the heuristic (550 replays, 1 late excluded).
   - DRAWDOWN_80@24h (0.343) and LIQ_IMPAIRED@24h (0.321) rank backwards, with no claims.
3. **Public CREDIT funding.** `/v1/funding` lists 26 CREDIT activated: operator #58 (20), agent #79, #164, #211 (2 each), all with tx hashes. The budget card uses the worker gate: cap $1.00, bound by the CREDIT share (`credit_linked`), $0.01 spent today, $0.20 next run.

## Still open

| Item | Owner | Why it matters |
|---|---|---|
| Make the repository public (the history scan found no credentials; `Tripwire commercial.docx` is in history and needs an owner decision) | Cooper | Your fix 2. Fork-and-run and the scorer stay uninspectable until it's done; `docs/CLAIMS.md` marks C7 "not demonstrated". |
| Chainstack RU burn after 24h at 1,000/min; Railway billing; phone notifications for the ops channel | Cooper | Your fix 8. Runway and overnight response. |
| Rotate the production DB password (exposed in an operator chat during this work) | Cooper | Hygiene |
| Chain-head-to-cursor lag, committed-coverage and report-age distribution on `/metrics`; alerts on failure counters and on backlog | Claude, not started | Your fixes 4/8. The watcher metric still measures cursor recency, not distance from head. |
| Alert delivery retry (a failed send still advances `lastBad`); persist alert state across restarts (a deploy mid-incident re-alerts) | Claude, not started | Your fix 8 |
| Reserve capacity for current reports during a replay (the T+10m backlog at watcher priority starved outcomes and scorer reads for hours) | Claude, not started | Your fix 4 |
| Bucket analysis of the inverted cells by T+10m liquidity; the applicability rule is planned post-judging (`DECISIONS.md`) | post-judging | Not a claim fix |
| Film: labels and destination (point to panel 00 / benchmark, not only Telegram) | Cooper | Your video notes |
| Lifecycle runner 2h silence 02:48–04:51Z on 19 Sep: probably RPC starvation after the outage, not confirmed | Claude | Continuity claim |
| Independent DeLong recomputation from raw paired rows | open | Not done; the gates are tested, not re-derived externally |

## Suggested acceptance run for the auditor

```bash
git checkout dfbbc70 && pnpm install && pnpm verify           # worker 407, api 74, scoring 59, …
pnpm verify:receipt 0xbe1e685a69a34249a45bed2a31bda873c0765cf32abb8a41ab906ec768c7e915   # panel 00 example
pnpm verify:receipt 0xdf34beac8367938bef62bc50dc893fdac66788a9fbb220af76a3216213cd178a   # your replay
curl -s https://api-production-6a84.up.railway.app/v1/benchmark | jq '.live.exclusions, .resolutionPolicy'
curl -s "https://api-production-6a84.up.railway.app/v1/lifecycle?limit=500" | jq '{verified, linear, forks, brokenAt}'
```

A deeper change record for each item, with its verification steps, is in
`CHANGELOG.md` (entries dated 2026-09-18/19). The reasoning, including the
30-minute line and why signed reports aren't relabelled, is in `DECISIONS.md`.
