# Tripwire Launch Auditor — demo walkthrough

For the team. A 5–10 minute guided path through what's live, plus how to check
any of it yourself. Every number below was pulled from production on
2026-09-18 around 23:30Z. They will have moved by the time you read this,
which is expected: the forecasts keep getting graded. Snapshot commit: `main` @ `c7ac43e` (M11).

## What it is, in one paragraph

For every new token launch on Robinhood Chain, the agent computes deterministic
manipulation and exit-risk features about ten minutes after the pool appears,
publishes probabilities for five mechanically-defined outcomes (insider exit,
sell impairment, liquidity impairment, 80% drawdown, still trading — eleven
outcome×horizon cells), signs and commits the forecast on-chain **before** the
outcome can be known, and later grades every forecast with an open-source
scorer against those outcomes and against public baselines. What it claims:
the forecast existed before the outcome; the scorer is reproducible; the
comparison to baselines is public. What it does not claim: that it pays for
itself, that no human is ever involved, or that a forecast is correct because
it was committed.

## Live links

| What | Where |
|---|---|
| Dashboard | https://web-production-ddcf3.up.railway.app |
| API | https://api-production-6a84.up.railway.app |
| Free feed (Telegram) | https://t.me/tripwirelaunchauditor |
| Chain | Robinhood Chain, id 4663 |
| Explorer | https://robinhoodchain.blockscout.com |
| CommitRegistry contract | `0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe` |
| Agent's Orbio account (gas wallet) | `0x9b4EDe199198ca3D41A9a7D2997606BaCd30BA03` |
| Report signer (EIP-712) | `0x6a5A2d5Ad4c4De33f851f971fa14923f5095B4BE` |
| CREDIT token | `0xe33322da1380e61e5ae5dfb21e7f62924c73004c` |

## The five-minute path

**1. Open the dashboard.** The top panel is Metabolism, the agent's own Orbio
account: state `ACTIVE`, AI balance **$25.42**, and the signed lifecycle log
(chain verified). Below it, Funding lists every CREDIT activation into that
account, each linking to its transaction:

- **#58 — 20 CREDIT, operator** (2026-09-16), activated directly into the agent's account
  ([tx](https://robinhoodchain.blockscout.com/tx/0xb7f87415d3b285c5daf3e94a66453396b3b9452813e557d61a73dca5659e2c24)).
- **#79, #164, #211 — 2 CREDIT each, agent** (09-17 02:58Z, 09-17 22:59Z,
  09-18 23:19Z). The agent activated these itself from CREDIT tokens the
  operator had transferred into its wallet. It holds **24 more** unactivated.

The operator's transfer is a plain token transfer, not an activation, so it
doesn't appear on the Funding card. It's on the wallet's Blockscout page.
Every decision about *when* to activate has been the agent's.

**2. Scroll to Live launches.** Each row is a real token, indexed as its pool
is created, with a `det_v0` forecast and a link to its on-chain proof once its
batch commits. Coverage and latency are measured live on `/metrics`
(`det_report_lag_seconds`, `commit_age_seconds`). The design target is a
report about 10 minutes after launch.

**3. Click a proof link.** It opens `/v1/proof/<hash>` — the report's Merkle
leaf, its proof, and the on-chain batch root it resolves to. Every report is
batched with up to 199 others (spec §6), so several proof links will point at
the same transaction; that's the batching working as designed, not a bug.

**4. Pick a token and open `/v1/launch/<token>` (new in M11).** This returns
what the scorer reads for that launch: which pool was chosen as primary
and why (`poolFeeSuspect`, `tokenAgeAtPoolSec`), the raw feature vector with
provenance for every value, and every outcome row with its evidence and scan
coverage. Paired with `/v1/report/<token>` (the forecasts), anyone can rebuild
a benchmark row from public data.

**5. Scroll to Benchmark.** Every forecaster is graded against realized
outcomes, with sample sizes always shown and hard rules: no metric shown below 100
resolved, and no "beats a baseline" claim below 200 resolved and 30 positives,
checked with a DeLong significance test. The comparison baselines, as of M11:

- `base_rate`: trailing 30-day prevalence. It moves over time, so on some
  cells it ranks better than chance by itself (AUROC 0.61 on
  `LIQ_IMPAIRED@24h`), which makes it a harder baseline than it looks.
- `base_rate_fixed` (**new**): one constant probability per cell. It scores
  exactly 0.5 AUROC by construction, and it's the floor every claim is now also
  checked against.

What the table says right now:

- **`det_v0` beats both base rates on three cells:**
  `TRADING_ALIVE@24h` (AUROC **0.652**, n=5,259, 196 positives),
  `INSIDER_EXIT@24h` (**0.765**, n=835, 91 positives), and
  `INSIDER_EXIT@6h` (**0.634**, n=2,736, 177 positives). On the two insider-exit
  cells the simple `heuristic_v1` rule does about as well (0.668 and 0.742).
  The signal there is mostly "creator dev-buy / launch-block cluster /
  concentrated holders", which the rule already captures.
- **`det_v0` ranks backwards on three cells:** AUROC **0.344** on
  `DRAWDOWN_80@24h` (n=1,227), **0.366** on `LIQ_IMPAIRED@24h` (n=3,048),
  **0.337** on `SELL_IMPAIRED@1h` (n=700). At those sample sizes this is far
  from noise. The hand-set weight *directions* in `det_v0` are wrong for those
  outcomes: the launches it rates riskiest are the ones *least* likely to crash
  or lose liquidity. `det_v0` still "beats" `heuristic_v1` on `LIQ_IMPAIRED`,
  but only because the heuristic is even more inverted (0.22), so that comparison means nothing.
- **Calibration is bad everywhere.** `det_v0`'s Brier Skill is negative on
  every cell (−0.98 on `TRADING_ALIVE@24h`, −10.4 on `SELL_IMPAIRED@1h`).
  "Beats X" is about ranking, not about the probability being right. **The
  public Telegram feed rounds these to "100% / 100% / 0%"**, which reads as
  certainty. It isn't; see the list below.
- **`llm_deepdive_v0`** (the Orbio-funded LLM forecaster) has 330 graded
  `INSIDER_EXIT@24h` forecasts at AUROC 0.463. It doesn't beat anything yet.
  That's the question the benchmark exists to answer, and so far the answer
  is no.
- **`det_v0.1`** (recalibrated intercepts, live since 09-17) has **1** graded
  outcome so far. Its first 24h horizons came due during the outage (below).
  It keeps `det_v0`'s weights, so it **cannot** fix the inverted cells above,
  only the calibration.
- `SELL_IMPAIRED` isn't used for claims. A fixed $100 test sell into a
  median ~$1k pool is almost always "impaired" by construction (723 of 801
  positive), so it's shown as a descriptive liquidity statistic, not a forecast.

**6. Scroll to Key lifecycle.** The signed, hash-chained log of every state
the agent's Orbio account has been in. The API key is derived from the agent
wallet's own signature (`Orbio API key · chain 4663 · epoch 0`). It isn't a
login or a session, so nothing expires. The only human action possible on the
account is funding it (step 1).

## What's proven and what isn't

We list the gaps here ourselves, before anyone else finds them.

- **Proven, live, checkable by anyone:** every committed report existed before
  its outcome; the scorer is open-source and reproducible; with M11, the scorer's
  *inputs* are public too (`/v1/launch/:token`). The benchmark contains
  **only** live, precommitted forecasts. There are zero backfilled rows; the
  `live` and `all` sections differ only by outcomes that resolved between the
  two scorer passes.
- **Proven, but narrow:** `det_v0` beats a real, constant baseline on three of
  eleven cells (above), and the simple heuristic does as well on two of them.
- **Not true yet:** `det_v0`'s probabilities aren't calibrated, and its ranking
  is inverted on drawdown, liquidity and 1h sell cells. Nobody should read a
  feed post as a probability to act on until a re-fitted model has its own
  track record.
- **An unmet spec promise, and why it's still unmet:** the spec commits to
  fitting `det_v1`, a real re-fit of the weights, once a cell passes 300
  resolved outcomes. Six of seven measured cells now qualify (up to 5,261 on
  `TRADING_ALIVE@24h`), and the inverted cells make it more pressing. It hasn't
  been built, and the reason is method, not data. Fitting on the same outcomes
  it's then scored against makes the benchmark in-sample and meaningless. The
  honest version fits on data up to time T and scores only forecasts issued
  after T, which means `det_v1` would start with zero graded outcomes.
- **The budget follows funding, by design:** the daily deep-dive budget is
  capped at half the CREDIT activated into the account in the trailing 24h
  (spec §0.1 property 2). With 2 CREDIT activated in the last day, that's $1
  today. The agent re-activates every ~20h ("keep-warm") from the 24 CREDIT it
  holds, which is roughly ten more days before it needs another transfer.
- **Proof of concept:** the agent's CREDIT comes from the operator's own
  staked ORBIO, transferred or activated by the operator. That's a human
  decision, on-chain and disclosed. The agent isn't earning for itself (yet).

## What broke this week

**2026-09-18, ~13h stall.** At 09:37Z the RPC provider's monthly request quota
ran out and every chain call started failing. The watcher, commits, outcome
grading and deep-dives all stopped. The alert loop posted "watcher stalled"
and "commit lag" to the private ops channel within ten minutes, but at 2:44 AM
local time nobody was watching. It was fixed at ~23:20Z by upgrading the plan
(20M → 80M request units/month) and lowering the agent's RPC ceiling from
3,000 to 1,000 req/min. The old ceiling is what used up the quota in about
three days. The watcher's cursor held during the outage and it replayed from
where it stopped. `watcher.pool_abandoned` doesn't appear on `/metrics`, meaning
no pool has been skipped. Forecasts for launches in that window were made late,
though, and anyone checking a report's `reportTime` against its `launchAt`
will see the gap. Full entry in `CHANGELOG.md`.

## Verify it yourself

```bash
API=https://api-production-6a84.up.railway.app

# production health: watcher staleness, commit age, report lag, failure counters
curl -s $API/metrics | grep -v '^#'

# the live launch feed (newest 200), with det_v0 forecasts and commit proof pointers
curl -s "$API/v1/launches?limit=200"

# one launch's scorer inputs: primary pool, feature vector + provenance, outcomes
curl -s "$API/v1/launch/<token>"

# every forecaster's forecast for that launch, with evidence and proof status
curl -s "$API/v1/report/<token>"

# the benchmark: every forecaster, every cell, sample sizes, overlap n, claim gates
curl -s $API/v1/benchmark

# one report's Merkle proof, verified locally + on-chain root confirmation
curl -s "$API/v1/proof/<reportHash>"

# the signed key-lifecycle chain + budget
curl -s "$API/v1/lifecycle?limit=50"

# every CREDIT activation into the agent's account, with tx hashes
curl -s $API/v1/funding
```

To check a commitment independently of this API: take a `reportHash` from
`/v1/launches`, find its batch's `BatchCommitted` event on
[Blockscout](https://robinhoodchain.blockscout.com/address/0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe),
and verify the sorted-pair keccak256 Merkle proof by hand. It's the same
computation `/v1/proof` does, and it doesn't require trusting this server.

A known gap: `/v1/launches` only returns the newest 200, so you need a token
address to reach older launches through the API. Paging the feed is on the list.

```bash
pnpm install && pnpm verify   # the full offline test suite, no network needed
```
