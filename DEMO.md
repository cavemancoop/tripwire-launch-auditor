# Tripwire Launch Auditor — demo walkthrough

A 5–10 minute path through what's live, and how to check it without trusting us.
Walked through logged out against the deployed commit **`0df3f67`** on
**2026-09-19 at ~09:30 UTC**. Numbers move as forecasts get graded, which is expected.

## What it is

Tripwire scores new token launches on Robinhood Chain for five mechanically
defined outcomes: insider exit, sell impairment, liquidity impairment, 80%
drawdown, and still trading. That's eleven outcome × horizon cells. It signs
each forecast and commits its hash on-chain a few minutes after the forecast's
T+10m anchor. Later it grades the forecasts with an open-source scorer against
chain data and public baselines, including existing scanners.

It claims:
- that a counted forecast was committed before its outcome window closed;
- that the scorer is reproducible;
- that any single forecast can be checked independently.

It does not claim:
- that the scores are calibrated probabilities (they rank launches);
- that it pays for itself;
- that a forecast is right because it was committed.

## Live links

| What | Where |
|---|---|
| Dashboard | https://web-production-ddcf3.up.railway.app |
| API | https://api-production-6a84.up.railway.app |
| Free feed (Telegram) | https://t.me/tripwirelaunchauditor |
| Public source | https://github.com/cavemancoop/tripwire-launch-auditor-public |
| Chain | Robinhood Chain, id 4663 · explorer https://robinhoodchain.blockscout.com |
| CommitRegistry | `0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe` |
| Report signer (EIP-712) | `0x6a5A2d5Ad4c4De33f851f971fa14923f5095B4BE` |
| Agent's Orbio account (gas wallet) | `0x9b4EDe199198ca3D41A9a7D2997606BaCd30BA03` |

## 1. One forecast, checked end to end (dashboard panel 00)

Feed post 884, token `0x1ff22250…1e18`:
- **Forecast:** `det_v0` scored insider exit within 24h at **0.996**, anchored at
  the T+10m block, 2026-09-15 01:46:47Z.
- **Committed:** in a block at 01:52:17Z, **330 s later**, tx
  `0xee1f992b…`, signed by `0x6a5A…B4BE`.
- **What happened:** the creator cluster did exit (INSIDER_EXIT true at 6h and
  24h). Liquidity was not impaired.

Check it yourself with no database and no credentials. Any chain-4663 RPC works:

```bash
pnpm verify:receipt 0xbe1e685a69a34249a45bed2a31bda873c0765cf32abb8a41ab906ec768c7e915
```

It recomputes `keccak256` of the exact signed bytes, recovers the EIP-712
signer from those bytes' own fields, and folds the Merkle proof. It then reads
the commit tx receipt and block timestamp from chain, and re-derives each
outcome's eligibility from that timestamp. Every check prints PASS or FAIL.

**This is one example, not evidence of skill.** Most launches score above 0.99.
It was picked from 113 completed, fully eligible forecasts in the 12–16 Sep
feed archive because it resolved the outcome `det_v0` is best at. Whether the
ranking works is section 2.

Every committed forecast in the Live launches table (panel 03) has its own
"receipt ↗". Feed posts link the same receipt.

## 2. What the eligible record says (panel 04)

A forecast counts toward a claim only if its commit landed on-chain, by block
time, **within 30 minutes of its T+10m anchor and before the outcome's
horizon ended**. On 19 Sep an independent audit found outage replays that had
been committed hours late and scored like everything else. The census after
the fix: **3,144 of 14,233 scored pairs (22%) were ineligible**, 608 of them
committed after their horizon had already ended. They're now excluded, and
they're counted under each outcome on the page.

On the eligible rows:

| Cell | `det_v0` AUROC | n / positives | Result |
|---|---:|---:|---|
| INSIDER_EXIT@24h | 0.764 | 653 / 75 | beats both base rates |
| TRADING_ALIVE@24h | 0.652 | 4,940 / 178 | beats both base rates and the heuristic |
| INSIDER_EXIT@6h | 0.619 | 2,132 / 121 | beats only the constant base rate; the simple heuristic does better (0.667) |
| DRAWDOWN_80@24h | 0.343 | 1,166 / 216 | **ranks backwards** |
| LIQ_IMPAIRED@24h | 0.322 | 1,561 / 409 | **ranks backwards** |
| SELL_IMPAIRED@1h | 0.335 | 532 / 478 | **ranks backwards** (and descriptive only) |

- **An existing scanner does better where we fail.** With its late fetches
  excluded, ScanHood beats both base rates and the heuristic on drawdown (0.631)
  and liquidity (0.586).
- **The LLM deep-dive** (`llm_deepdive_v0`, Orbio-funded): AUROC 0.458 on
  n=446 for insider exit 24h. There's no evidence yet that it adds
  discrimination.
- **Calibration:** `det_v0`'s Brier Skill is negative on every cell. The scores
  rank launches; they aren't probabilities. The feed shows rank tiers, never
  percentages.
- **Graded rows aren't a random sample.** The resolver has a backlog of about
  239k horizon-due pending outcomes (19 Sep). It works oldest first, and grades three of the five
  labels for qualified launches only. None of 400 feed posts from 17–18 Sep had
  a resolved outcome yet. Each outcome on the page shows graded, pending and
  unresolvable counts, and the policy is stated under the table.

Why the three cells are inverted, and the planned fix (an applicability rule,
after judging), are in `DECISIONS.md` under "Inverted cells". No weights were
refit after seeing these results.

## 3. What Orbio funded (panel 01)

- **Funding:** the operator activated 20 CREDIT directly (#58, 16 Sep) and
  transferred CREDIT tokens into the agent's wallet. The agent has since
  activated 3 × 2 CREDIT itself (#79, #164, #211), and each activation is a
  linked transaction.
- **Budget:** today's deep-dive budget uses the worker's own gate: the
  configured $5 ceiling, then half of the CREDIT activated in the last 24h
  ($1.00 today), then the balance above reserve. The card shows which term
  binds, the spend since 00:00 UTC, and whether it has fallen back to the flat
  ceiling.
- **Key:** the API key is a signature from the agent's wallet, so there's no
  session to expire. The agent still depends on its RPC provider, funding, gas,
  and the operator-held wallet key.
- **Custody:** the worker's code only activates CREDIT; its call allowlist
  refuses transfers. That's an application check, not a wallet restriction.
- **Lifecycle log:** the signed, hash-chained log verifies as **intact with 2
  forks**. Those were two worker containers appending at once during 18–19 Sep
  deploys. No row was altered. Appends are now serialized.

## 4. What broke this week

- **18 Sep, ~13h stall.** The RPC provider's monthly quota ran out, and the
  watcher, commits, grading and deep-dives stopped. The ops alerts fired within
  ten minutes, at 2:44 AM local, and nobody saw them. It was fixed by a plan
  upgrade and cutting the agent's RPC rate from 3,000 to 1,000 req/min. The
  lifecycle panel's "longest gap between rows: 13.7 h" is this outage.
- **Late forecasts.** Launches from the outage (and a 16 Sep backlog) got
  forecasts built hours late, still anchored at T+10m. The audit caught them;
  they're now excluded from claims (section 2).
- **Chain forks** from overlapping deploys (section 3), now prevented.

Details and verification steps for each are in `CHANGELOG.md`.

## The main operational risk: the resolver can't keep up

As of 19 Sep ~09:45Z, **239,609** outcomes are past their horizon and still
ungraded. The resolver graded **640** in the previous 24 hours. Of all
outcomes whose horizon has passed, **6.5% are graded** (17,407 of 267,069).
This is shown above the benchmark table. At this rate most forecasts will
never be graded, and the benchmark describes a small subset that isn't a
random sample.

The failure counters on `/metrics` total **11,760** since they were added on
17 Sep. Most are from the 18 Sep outage: 6,390 failed outcome resolutions,
2,984 watcher poll errors, 921 failed deep-dives, 706 commit-loop errors and
655 lifecycle tick errors. None of this is hidden; it's the first thing to
fix after judging.

## Verify it yourself

```bash
API=https://api-production-6a84.up.railway.app
curl -s $API/v1/receipt/<reportHash>      # one forecast: signed bytes, signature, proof, chain time, outcomes
pnpm verify:receipt <reportHash>          # checks that receipt without trusting the server
curl -s "$API/v1/launches?limit=200"       # every live launch, newest first; follow nextCursor via ?before=
curl -s $API/v1/launch/<token>            # the scorer's inputs: primary pool, features + provenance, outcome rows
curl -s $API/v1/benchmark                 # every cell: eligible rows, exclusions by class, coverage, policy
curl -s $API/v1/funding                   # every CREDIT activation, with tx hashes
curl -s "$API/v1/lifecycle?limit=50"      # signed log (verified / forks) + the budget the gate uses
curl -s $API/metrics                      # watcher staleness, report lag, failure counters
pnpm install && pnpm verify               # the offline test suite (contract tests skipped without Foundry)
```

**Known gaps:**
- Probabilities aren't calibrated, and `det_v1` (a real refit) is held until
  it can be fitted before a cutoff and scored only after it.
