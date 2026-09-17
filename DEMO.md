# Tripwire Launch Auditor — demo walkthrough

For the team. A 5–10 minute guided path through what's live, plus how to check
any of it yourself. Every number below is real and pulled live on
2026-09-17; it will already have moved by the time you read this — that's
the point. Snapshot commit: `main` @ `68ce5ce` + the property-2 change that
follows it.

## What it is, in one paragraph

For every new token launch on Robinhood Chain, the agent computes deterministic
manipulation and exit-risk features within seconds, publishes probabilities for
five mechanically-defined outcomes (insider exit, sell impairment, liquidity
impairment, 80% drawdown, still trading — eleven outcome×horizon cells), signs
and commits the forecast on-chain **before** the outcome can be known, and
later grades every forecast with an open-source scorer against those outcomes
and against public baselines. What it claims: the forecast existed before the
outcome; the scorer is reproducible; the comparison to baselines is public.
What it does not claim: that it pays for itself, that no human is ever
involved, or that a forecast is correct because it was committed.

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

**1. Open the dashboard.** The top panel is Metabolism — the agent's own
Orbio account, live: current AI balance, today's deep-dive budget, and the
signed lifecycle log. Below it, Funding lists every CREDIT activation into the
agent's account with a link to the transaction — right now, one: activation
#58, 20 CREDIT, from the operator's own wallet, [on Blockscout](https://robinhoodchain.blockscout.com/tx/0xb7f87415d3b285c5daf3e94a66453396b3b9452813e557d61a73dca5659e2c24).
That transaction is the only funding this instance has ever received; everything
since — every deep-dive, every activation decision — has been the agent's own.

**2. Scroll to Live launches.** Each row is a real token, indexed within
seconds of its pool being created, with a `det_v0` forecast and a link to its
on-chain proof. As of this snapshot: of launches at least 15 minutes old,
**147 of 148 (99.3%) are committed**, and the newest committed report lagged
its launch by about **10 minutes** — the T+10m feature window the design
targets, not an aspiration.

**3. Click a proof link.** It opens `/v1/proof/<hash>` — the report's Merkle
leaf, its proof, and the on-chain batch root it resolves to. Every report is
batched with up to 199 others (spec §6), so several proof links will point at
the same transaction; that's the batching working as designed, not a bug.

**4. Scroll to Benchmark.** Every forecaster graded against realized
outcomes, with sample sizes always shown and a hard rule: no metric below 100
resolved, no "beats a baseline" claim below 200 resolved and 30 positives,
checked with a DeLong significance test. Right now:
- `TRADING_ALIVE@24h`: `det_v0` beats `base_rate` (n=2,535, AUROC 0.564 vs
  base rate's 0.460) — the cleanest result in the table: a real baseline,
  not a weak one.
- Several other cells clear the bar (`INSIDER_EXIT@6h` heuristic vs base rate,
  `LIQ_IMPAIRED@24h`, `DRAWDOWN_80@24h`) but against **`heuristic_v1`**, a
  deliberately simple rule — those are real, significant results, just a
  lower bar than beating the base rate.
- **"Beats X" means the ranking is statistically distinguishable from X's
  (DeLong test) — it does not mean the probability itself is well-calibrated.**
  Brier Skill is shown next to it for exactly that reason, and it is negative
  on every cell in the table right now, `det_v0` included. The forecaster
  discriminates better than chance in places; its stated probabilities are not
  yet trustworthy at face value. `det_v0.1` (recalibrated intercepts on 4 of 5
  measured cells; `SELL_IMPAIRED` deliberately held back pending independent
  validation — see `DECISIONS.md`) is now live and scoring in parallel as of
  2026-09-17, but has zero graded outcomes yet — it needs its own track record
  before the public feed switches to it, not a promise, a still-open measurement.
- `SELL_IMPAIRED` is intentionally excluded from claims — a fixed $100 test
  sell against median ~$1k pools is almost always "impaired" by construction;
  it's shown as a descriptive liquidity-depth statistic, not a forecast.

**5. Scroll to Key lifecycle.** The signed, hash-chained log of every state
the agent's Orbio account has been in. As of 2026-09-16 the agent's API key is
derived from its own wallet's signature (`Orbio API key · chain 4663 · epoch
0`) — not a login, not a session, nothing that expires. The only human action
possible on this account is funding it (step 1); key creation, rotation and
revocation don't apply to a wallet-signed key the way they did to the old
OAuth-issued one.

## What's actually proven vs. not yet — read this before anyone else does

Stated plainly, in the project's own style: showing the blanks is the
discipline.

- **Proven, live, checkable by anyone:** every committed report existed before
  its outcome; the scorer is open-source and reproducible; the agent's Orbio
  funding is exactly one on-chain transaction, and every dollar since has been
  the agent's own key, spent and tracked in the open. The benchmark contains
  **only** live, precommitted forecasts — zero backfilled rows folded in. That's
  the rarer property to have and the reason it stays that way: importing
  retrospective data would dilute a "no cherry-picking" claim that the live
  rows alone already prove, not strengthen it.
- **Proven, but narrow:** `det_v0` beats a real baseline on exactly one cell
  (`TRADING_ALIVE@24h`); several more beat a weaker heuristic baseline. Most of
  the eleven cells don't clear the claim bar yet, mainly on sample size for
  the rarer outcomes.
- **Not yet true, in progress:** `det_v0`'s probabilities are not well
  calibrated (negative Brier Skill everywhere) — `det_v0.1` is live and
  accumulating its own track record (above), so nobody should read "beats
  base_rate" as "is accurate" until that's measured.
- **An unmet spec promise, and why it's staying unmet for now:** the spec
  commits to fitting `det_v1` — a real re-fit of the model's weights, not
  just intercept recalibration — once resolved outcomes exceed 300 for a
  cell. Six of the seven outcome/horizon cells now qualify (up to 3,452
  resolved on `TRADING_ALIVE@24h`). It has not been built. Not for lack of
  data: fitting `det_v1` on the same live outcomes it would then be scored
  against makes the benchmark in-sample and meaningless. Doing it honestly
  means fitting on data up to some time T and scoring only forecasts issued
  after T — which means `det_v1` would arrive with zero graded outcomes,
  exactly where `llm_deepdive_v0` sits today. The unmet promise is the
  methodologically disciplined outcome here, not an oversight.
- **A real, disclosed constraint, not a bug:** the daily deep-dive budget is
  now literally a function of CREDIT activated into the agent's account in the
  trailing 24 hours (spec §0.1 property 2, wired in 2026-09-16). That's a
  rolling window — without further funding, it trends toward $0 about a day
  after the last activation, even while real balance remains. This is the
  property working as specified ("throughput visibly follows token
  activity"), and it means the account is due for another top-up.
- **Proof-of-concept, said outright:** the agent's funding today is the
  operator activating CREDIT earned from his own staked ORBIO — a human
  decision, on-chain and disclosed, not the agent earning autonomously (yet).
  The mechanism for the agent to stake and earn its own credit exists in the
  protocol; this instance hasn't been given ORBIO to do that with.

## Verify it yourself

```bash
API=https://api-production-6a84.up.railway.app

# production health: watcher staleness, commit age, report coverage/lag
curl -s $API/metrics | grep -v '^#'

# the live launch feed, with det_v0 coverage and commit proof pointers
curl -s "$API/v1/launches?limit=200"

# the benchmark: every forecaster, every cell, sample sizes, claim gates
curl -s $API/v1/benchmark

# one report's Merkle proof, verified locally + on-chain root confirmation
curl -s "$API/v1/proof/<reportHash>"

# the signed key-lifecycle chain + the M5c cost-forecast estimator
curl -s "$API/v1/lifecycle?limit=50"

# every CREDIT activation into the agent's account, with tx hashes
curl -s $API/v1/funding
```

To check a commitment independently of this API entirely: take a `reportHash`
from `/v1/launches`, find its batch's `BatchCommitted` event on
[Blockscout](https://robinhoodchain.blockscout.com/address/0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe),
and verify the sorted-pair keccak256 Merkle proof by hand — the same
computation `/v1/proof` does, with no need to trust this server.

```bash
pnpm install && pnpm verify   # the full offline test suite, no network needed
```
