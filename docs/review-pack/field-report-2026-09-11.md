<!-- Converted from the published "Launch Auditor Field Report" artifact (last updated 2026-09-12).
     This is the complete version; the tracked `Launch Auditor Field Report.pdf` is a 2026-09-11 browser
     print of an earlier draft that is truncated mid-§09 and lacks the 200-word version. Numbers are as of
     11 Sep 2026 and are NOT current. Layout (grids, callouts, pills) is flattened; wording is unchanged. -->

Field Report
Robinhood Chain · id 4663
11 Sep 2026
Build Week · day 6 of 7

# A forecast that can't be edited after the fact

Launch Auditor watches every new token on Robinhood Chain, publishes numbered predictions about how it will go wrong, stamps them on the blockchain before anyone can know the answer, then grades itself in public — alongside the existing scanners. This is the working state, the measurements so far, and the parts that aren't proven yet.

**Launches indexed:** 1,608 (358 live)

**Signed forecasts:** 4,463

**Outcomes graded:** 963

**Base rates measured:** 2 / 11 cells · replayed

**Live track record:** 0 / 11 cells

Those last two are different claims and the distinction is the whole point. **Base rates** come from replaying history — they calibrate the model. A **live track record** means a forecast was committed on-chain before its outcome existed, then graded. The live record is days old and no cell has enough of it yet.

§01

## What it is, for someone who has never traded a token

Thousands of new tokens launch every day on this blockchain. Most are worthless within hours. Tools exist that will scan one and tell you it looks risky — but nobody ever checks whether those warnings were right.

Launch Auditor does the checking. For every new token it publishes specific, numbered predictions — *"73% chance the people who created this dump their holdings within 6 hours"* — and writes a fingerprint of that prediction onto the blockchain immediately, where it can't be quietly changed later. Days afterward, it looks at what actually happened and scores itself. Then it publishes the scorecard.

The product isn't the warning. Plenty of tools give warnings. The product is **the track record** — a public, tamper-evident answer to "how often is this thing right?", which no existing scanner offers about itself.

### The same thing, precisely

For each launch the agent computes deterministic manipulation and exit-risk features within seconds, publishes separate probabilities for **five mechanically-defined outcomes across eleven outcome cells** (each outcome measured at one or more fixed horizons), signs the forecast and commits its hash on-chain before the outcome can be known, and later grades every forecast with an open-source scorer against the realized outcome and against public baselines — the base rate, a fixed heuristic, and the existing scanners' own verdicts.

§02

## Why this gap exists

Token launches used to unfold over days — discovery, then social proof, then a decision to buy. On a chain doing roughly **14,000 launches a day**, all three collapse into the same sixty seconds. Someone posts a contract address; people buy inside a minute; by the time a research page loads the decision is already made.

That reshapes what's scarce. It isn't information about the token — several tools compute that competently. It's **context at the moment of execution**, in a form a machine can consume, from a source with a published error rate.

### What already exists

**RobinSight** — the closest competitor. Entity clustering by shared funder, holder trim-profiles, local contract audit with evidence. Genuinely good, and more polished than ours on contract analysis.

**ScanHood, GoPlus, Robinhood Checker** — fast verdict APIs on contract safety and sellability.

### What none of them do

- **Commit before the fact.** Every verdict is a live snapshot, editable and unaudited.
- **Publish a hit rate.** No scanner tells you how often it was right.
- **Grade the others.** We score ScanHood and GoPlus as named forecasters in the same table as ourselves.
- **Model a timeline.** They rate the token now; we forecast a specific outcome at a specific hour.

### The honest framing

Leading with "we're the benchmark" reads as a ranking claim. The real line is the mechanism: **we publish the forecast before the result, then grade our own outcomes in public alongside everyone else's.** Being the benchmark is a consequence of that, not an assertion.

§03

## The loop

1. **Watch** — A poller reads every Uniswap pool-creation event on the chain. A freshness check rejects pools for tokens that already existed, so pre-existing assets don't get scored as launches.
2. **Measure** — Within seconds: creator history, holder concentration, a wallet cluster built from on-chain evidence, contract flags, v4 hook permissions decoded from the hook address itself, and a simulated sell to price the exit.
3. **Forecast & sign** — Several independent forecasters produce probabilities for the same eleven outcome cells. Each report is canonicalized, signed with the agent's key, and put through a validator that rejects anything treating an unknown as a pass.
4. **Commit** — Report hashes are batched into a Merkle tree and the root is posted to a registry contract on-chain. The forecast's existence and content are provable, and its timestamp precedes the outcome.
5. **Grade** — At each horizon the agent replays chain data to determine what actually happened, then an open scorer computes calibration and discrimination for every forecaster against the same outcomes.

### Who is forecasting

Five graded participants: `det_v0` (a hand-built statistical model), `det_v0.1` (the same model with intercepts reset to measured base rates), `heuristic_v1` (a deliberately simple rule, as a floor), `base_rate` (the trailing average — the honest baseline any model must beat), and the external scanners mapped onto the same probability scale. A sixth, `llm_deepdive_v0`, is an LLM that investigates qualified launches with read-only chain tools and is scored as just another forecaster — so the dashboard answers whether narrative analysis adds anything over arithmetic.

§04

## What is not proven

Placed before the numbers on purpose. This is the section a skeptical reader should use to decide how much weight the rest deserves.

- **No cell has a live precommitted track record yet.** The base rates below come from *replaying* history, which calibrates the model honestly but is not the same as having forecast something in advance and been graded on it. The live record started days ago.
- **The LLM forecaster has no grades at all.** It began producing reports today; they resolve at 24h and 7d. At submission it will have a track record of roughly zero — the newest forecaster in a project about track records.
- **Most cells are too thin to claim anything.** Two of eleven clear the bar. The remedy is compute rather than insight, but it isn't done.
- **Unattended continuity has a measured limit.** The agent ran clean — one snapshot a minute, no gaps — for roughly two and a half hours, then its Orbio session lapsed and every tick reported "not authorized." The refresh did not survive the access-token lifetime; a human sign-in is required to resume. That is now a number on the dashboard rather than an assumption: *unattended for N hours; refresh requires a sign-in.* The safety response is correct — inference refuses to spend while the balance is unwatched — but the "zero-touch" claim is bounded, and this is the bound.
- **One outcome definition doesn't discriminate** (SELL\_IMPAIRED, below). It measures something real but is true 96% of the time, so it can't separate one launch from another.
- **The insider-exit measure is narrow by construction.** It tracks a wallet cluster built only from direct on-chain evidence. Insiders funding wallets through paths we don't trace are invisible to it. The 12% figure is a floor of unknown tightness.
- **Committing a forecast says nothing about its quality.** It proves the forecast existed beforehand. That's all. Quality is what the scorecard is for, and the scorecard is mostly still blank.

### What it explicitly does not claim

That it pays for itself. That no human touched the server. That its analysis is right. The three things it does claim: the forecast existed before the outcome, the scorer is reproducible, and the comparison to baselines is public.

§05

## What the measurements say

These are realized base rates from replaying two weeks of history on qualified launches — not predictions, but what actually happened. **The sample sizes are the point.** A cell needs **200 graded outcomes and at least 30 positive cases** before the scorer will let a claim be made. The positives bar matters: at a 12% base rate, 200 outcomes is only 24 positives, far too few to say anything about discrimination. Showing the blanks is the discipline.

| Outcome cell | Graded | Positives | Rate | Share of launches | Status |
| --- | --- | --- | --- | --- | --- |
| TRADING\_ALIVE @24h | 245 | 66 | 27% |  | Claim-ready |
| DRAWDOWN\_80 @24h | 218 | 74 | 34% |  | Claim-ready |
| LIQ\_IMPAIRED @24h | 194 | 80 | 41% |  | 6 outcomes short |
| INSIDER\_EXIT @6h | 151 | 18 | 12% |  | Short on both |
| INSIDER\_EXIT @24h | 53 | 6 | 11% |  | Too thin |
| SELL\_IMPAIRED @1h / @24h | 102 | 98 | ~96% |  | Excluded |
| All @7d cells · INSIDER\_EXIT @72h | 0 | 0 | — | — | No data |

Graded = outcomes resolved from chain data with a definite true/false, by replaying history. None of this is a live precommitted record. 12,380 more outcomes are queued and resolvable — filling them is compute, not research.

### The finding that matters

Of qualified launches — ones that cleared a real buyer threshold, not spam — **only 27% are still trading 24 hours later.** Roughly three in four die within a day. One in three loses 80% of its price. Two in five lose most of their liquidity. This is the shape of the thing the product exists to describe, and it's measured, not asserted.

### Why one row is flagged

SELL\_IMPAIRED reads ~96% true, which looked implausible. One real bug was found and fixed along the way — the resolver was scoring a failed simulation as a confirmed failure to sell, and a failed call is now *unresolved*, never an outcome. The rate stayed high afterward, so we checked the pools themselves:

| Liquidity on a qualified launch, 10 min in | USD |
| --- | --- |
| 25th percentile | 6 |
| Median | 1,040 |
| 75th percentile | 5,267 |
| Share under $5,000 | 72% |

The test sells a fixed **$100**. Against a $1,040 pool that is a tenth of the entire market, which on a concentrated-liquidity pool blows through 30% slippage without difficulty. **96% is therefore real.**

Which converts a suspected bug into a sharper design problem: an outcome that is true 96% of the time carries almost no information. Always predicting "impaired" scores well and tells a trader nothing. The cell either needs the sell sized *relative to pool depth* so it can discriminate, or it should leave the scored set and survive as a descriptive statistic — *a $100 exit is impaired on 96% of new launches* — which is a striking sentence but not a forecast. **It is excluded from the model until that is decided.**

§06

## What building it taught us

### The chain is mostly noise

~14,000 launches a day, but only ~8,500 pair against a real quote asset, and of 1,250 sampled historical launches only **161 cleared the qualified bar**. A census of everything is neither affordable nor meaningful; sampling the real ones is.

### Decoy pools broke our own data

44% of sampled launches had a pool with a fee over 10% — junk pools with no trades. Our watcher was recording those as the token's real market, so every downstream price and liquidity check failed. One casualty was a **tokenized NVIDIA stock with $75M of real liquidity** recorded against a 43%-fee decoy. Now the primary pool is re-derived at report time from the quote asset, fee tier, and actual trading activity.

### Infrastructure was the real constraint

Three blockchain data providers in a week. The first had a broken archive; the second throttled hard and mangled large queries; a paid node finally unblocked it. A backfill that appeared to hang for 24 hours turned out to be one unguarded network call with no timeout. Most of the engineering difficulty was here, not in the modeling.

### The instrument needs auditing too

Two separate bugs produced confident, wrong outcomes — a failed call scored as a verdict, and a wrong pool scored as a market. Both were only visible because the pipeline grades itself and the numbers looked implausible. A tool that never checks its own output would have shipped both.

§07

## The part that isn't about trading

This was built for a contest run by **Orbio**, which grants AI agents inference credits. That imposed a specific test, and it's the most unusual thing in the build: *would this demo work identically on a plain API key? If yes, it proves nothing.*

So the agent manages its own credentials. It mints its own gateway key, polls its balance every 60 seconds, and the size of its daily research budget is a direct function of credits accrued in the last 24 hours — throughput visibly follows the token's activity, and the agent never holds or converts money to make that happen. Every state change is written to a hash-chained, signed lifecycle log. It went `NO_KEY → ACTIVE` on its own and ran unattended for about two and a half hours before its session lapsed (§04).

Money is accounted for the way everything else here is: with its provenance attached. Orbio's own spend counter is the authoritative figure and the only input to the hard budget. Each report's cost is a token-priced *estimate*, labelled as such, and every sixty seconds the estimates are reconciled against what Orbio actually charged. The gap between the two is the agent forecasting its own bill and being graded on it — the same discipline applied to the metabolism as to the forecasts. The credential is revoked in exactly one circumstance: the provider charges while the agent made no calls. An estimate being wrong pauses inference; it never touches the key.

**Registry contract:** 0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe

**Latest batch root:** 0xe981b60f6c005de6bf1389ee6f79f0b88ddf9f1c26751d96a2395504dfeb9720

**Agent-minted key:** sk-orbio-dY3Oyq · balance $46.10 · spendable $43.10

**Artifact commits:** 12 — weights, feature code, outcome rules, scorer, mappings

The weights, the feature code and the outcome definitions are themselves hashed on-chain, so a change to the rules after a forecast is detectable.

§08

## Where it goes, if it goes anywhere

The interesting direction isn't a better scanner — that market is served. It's the two things this architecture makes possible that a scanner can't do, because both need a commitment mechanism and a wallet index:

### A caller scorecard

Score the people who promote tokens, by outcome. Not follower counts — realized profit and loss for someone who bought a caller's picks at a stated delay. *"Buying this wallet 30 seconds late averaged −12% over the last 20 calls; the wallet itself made +180%."* Feedback from active traders was that this is the number they'd act on, and that it has to be a rolling window because a public edge gets competed away.

### An LP outcome oracle

The same event data can compute exactly what a liquidity position at any price range would have earned in fees and lost to impermanent loss. Turned around, that's a forecast — *fees minus IL over the next 24h versus simply holding* — graded like every other forecast. Impermanent loss is one of the largest quiet losses retail takes, and nobody publishes a scored prediction of it.

Both are roadmap, not built. Neither belongs in contest week.

§09

## How to pressure-test this

If you want to find the weak points, these are the questions that actually bite. They're ordered by how much damage a bad answer does.

1. **Who is the user, concretely, and what do they do differently because of this?** — The honest answer so far is "a trading bot or a terminal that wants a demand gate." Individual traders buying in 30 seconds may not read anything. If the answer is only "integrators," the product is a B2B data feed, not a consumer tool — which is fine, but changes everything downstream.
2. **Does a published scorecard survive contact with the people it scores?** — Callers and launchpads are the natural customers and the natural subjects. A launchpad whose pools score badly has no incentive to surface the score. Terminals earn on volume whether trades win or lose. Who pays for a number that reduces trading?
3. **Is 245 graded outcomes enough to say anything?** — Two cells clear the project's own bar. Push on whether that bar is high enough, and whether retrospective backfill data — replayed history, not live forecasts — should count toward a track record at all.
4. **Is the insider-exit cluster too narrow to be meaningful?**12% of launches show a creator-cluster exit within 6 hours. If real insiders route through wallets the cluster can't reach, that 12% is a floor of unknown tightness, and the headline understates the problem it claims to measure.
5. **Does on-chain commitment matter to anyone but the builder?** — A trader wants "this usually dumps on you." Precommitment is the mechanism that makes the claim defensible under challenge — but if no one ever challenges it, it's expensive ceremony. Test whether anyone asks for the proof.
6. **If the LLM forecaster doesn't beat the arithmetic, what then?** — That's a legitimate published finding and arguably the most useful one. But it should be decided in advance that a null result gets published, not quietly dropped.

§10

## The 200-word version

The text for the submission form, written to stay inside what §04 says is provable.

Launch Auditor watches every new token on Robinhood Chain, computes deterministic manipulation and exit-risk features within seconds, and publishes separate probabilities for five mechanically defined outcomes — insider exit, sell impairment, liquidity impairment, 80% drawdown, still trading — at fixed horizons. Every forecast is signed and its hash committed on-chain before the outcome can be known; an open-source scorer later grades it against chain data and against public baselines, including the existing scanners' own verdicts. The product is not the warning but the track record.

The agent runs on an Orbio key it minted itself: it polls its balance every minute, sizes its daily research budget from credits accrued in the last 24 hours, and writes every state change to a signed lifecycle log — it never holds or converts money. Anyone holding $ORBIO can clone the repo, authorize once, and run their own instance.

What is measured so far: 1,608 launches indexed, 4,463 signed forecasts, 963 outcomes graded, two of eleven cells with base rates; of qualified launches, 27% are still trading after 24 hours. What is not yet proven: the LLM forecaster has no grades, most cells are thin, and the live precommitted record is days old. Registry: 0xF36F…BEe.

Launch Auditor · field report · 11 September 2026
chain 4663 · M0–M6 complete · M7–M10 remaining
