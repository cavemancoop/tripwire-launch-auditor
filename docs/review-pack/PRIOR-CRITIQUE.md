# Prior critiques — verbatim, with what changed in response

Two external reviews preceded the Codex review. Both are reproduced verbatim, each
followed by one line per item on what the project changed in response. The response
tables are the builder's account; test them.

- **Part 1 — Red-team of the v0.1 spec and economics** (written ~2026-09-02, against
  the v0.1 spec, economics report and spreadsheet model; none of those v0.1 documents
  are in this pack). The v0.2 spec's §11 "Cut from v0.1 and why" is the direct response.
- **Part 2 — Billing-architecture review** (2026-09-12, during M5c). Cited in
  `DECISIONS.md` as "external review, adopted in full".

Status legend in the response tables: **Changed** (design or code changed),
**Partly** (some of it done), **Not done**, **Moot** (the thing criticised was removed
or never built), **Deferred** (explicitly scheduled after the contest).

---

# Part 1 — Red-team (verbatim)

I reviewed the technical spec, economics report, spreadsheet model, the live Orbio competition materials, current Orbio mechanics, Robinhood Chain infrastructure, Pons/Noxa launch mechanics, x402 infrastructure, and the current competitive landscape.

The conclusion is materially worse than the documents suggest: **there is a potentially good contest entry buried inside this, but the business/tokenomics thesis as written is not yet credible.** Two of its central premises are already false or badly framed: Robinhood Chain token-risk tooling is not uncontested, and the agent does not meaningfully “pay for its own compute” from its own economic activity.

## 1. Steelman

The strongest version of this idea is **not** “an AI rug checker that buys $ORBIO.”

It is:

> **A low-latency, machine-consumable risk oracle for newly launched Robinhood Chain assets whose forecasts are timestamped before outcomes occur and whose historical predictive performance can be independently audited.**

That is substantially better.

The core insight is that virtually every token scanner tells you what a contract looks like **now**. Very few can prove, retrospectively, “this is exactly the probability I published before the rug/dump/collapse happened, and here is my entire unedited historical record.” The spec's commit-before-outcome mechanism is the genuinely interesting component: every report is signed and committed before the outcome, then scored later under a versioned outcome rule.

The single most compelling reason it could work is therefore **not AI, x402, Orbio, autonomy, or the RevenueRouter**. It is that automated trading systems actually have a use for a low-latency risk signal if you can demonstrate that the signal improves expected trading outcomes. A bot doesn't need prose; it needs something like:

`P(insider dump < 6h)=0.71; P(exit impairment < 1h)=0.18; manipulation=HIGH`

with a demonstrably better track record than a few hand-written heuristics.

The Orbio Build Week is legitimately well suited to demonstrating the *plumbing*: official materials confirm the $100 inference grant, +20% holder-credit boost, seven-day build, ten winners, 8M ORBIO prize pool, and public-by-day-seven requirement. The starter repo explicitly suggests “agents on the rails” that claim/rotate their own Orbio keys. ([Orbio][1])

But that is contest fit. It is not evidence of product-market fit.

---

# 2. Attack the steelman

## A. Economic loop: the advertised flywheel does **not** close

This is the first serious problem.

The report correctly admits that Orbio credits come from **total ORBIO trading activity**, not from Launch Auditor revenue. It says the router's ORBIO purchases increase the holder share slowly and that the loop “closes at the ecosystem level.”

That caveat is doing enormous work.

Current Orbio documentation now makes the mechanics clearer: approximately **0.75% of ORBIO trading volume becomes holder credits**, distributed according to time-weighted eligible holdings. Ordinary contracts and sub-threshold holdings are excluded from the denominator. ([Orbio][2])

So the actual equation is approximately:

**Launch Auditor compute subsidy = external ORBIO trading volume × 0.75% × your effective eligible-holder share.**

Notice what is absent: **Launch Auditor revenue.**

If Launch Auditor earns $1 and buys $1 of ORBIO, that $1 purchase contributes roughly $0.0075 to the *entire holder credit pool*. Launch Auditor then receives only its fractional holder share of that $0.0075. Even at an absurdly large 1% effective share, buying $1 of ORBIO returns roughly **$0.000075 of incremental immediate credit**.

That is not a self-funding loop. It is economically negligible.

The router purchases help primarily by increasing future ownership share. But the spreadsheet itself demonstrates that compounding can't keep up with the assumed service growth: its coverage ratio falls from ~10.4× in month 1 to ~1.15× in month 8 and ~0.35× by month 12 despite continuous ORBIO accumulation. In other words, **even the optimistic model disproves the strong version of the flywheel.**

### Weak-demand case

Use the project's own prices.

If T0 is free during launch and you sell only 20 T1 reports/day:

**20 × $0.15 = $3/day = $90/month revenue.**

That doesn't cover the stated $100–250/month infrastructure, gas, facilitator fees, or any labor.

At approximately $200/month infrastructure + $30 gas, you need roughly **51 T1 sales/day simply to cover cash costs**, assuming Orbio subsidizes all model compute.

If you recognize the model's ~$0.07 blended inference as a real economic cost rather than pretending credits are free money, the required volume rises to roughly **96 T1 sales/day**.

And this excludes your time.

There is also a spreadsheet inconsistency: the narrative calls T1 margin roughly 65–75%, but the actual blended model cost of $0.07 against a $0.15 price produces only **~53% gross margin**, while the $0.25 escalation path loses money at the fixed $0.15 price. The report's own unit economics disclose those paths.

### Is it Ponzi-shaped?

Not literally a Ponzi: there is no promised redeemable return and the credits are product access rather than cash.

But it can become **reflexive-token-subsidy-shaped**:

ORBIO speculation → trading fees → agent compute → agents create ORBIO utility narrative → more ORBIO buying/trading → more credits.

If external customers never develop, the apparent economic activity is ultimately financed by continued ORBIO trading rather than customers buying useful services. If ORBIO volume collapses, the subsidy collapses with it.

That distinction will not be lost on sophisticated crypto people.

**Fix:** eliminate “self-funding” from the central pitch. Publish two P&Ls:

1. **Standalone economics:** pretend every OpenRouter dollar costs cash.
2. **Orbio-subsidized economics:** show how much of that cost happens to be covered by credits.

If the standalone business doesn't work, ORBIO is a subsidy, not a business model.

---

## B. Demand: the biggest assumption is already contradicted by reality

The document says:

> “Nobody sells this on Robinhood Chain today.”

That is false as of September 2.

There are already multiple Robinhood-specific risk products.

Robinhood Checker currently advertises bundler/sniper/insider detection, developer funding traces, honeypot/security checks, holder concentration, LP analysis, serial-rug detection, a risk score, Telegram scanning, and dev-wallet monitoring — **free**. ([Robinhood Checker][3])

ScanHood is open source and already exposes a REST API **and MCP server**, including honeypot simulation, LP checks and deployer reputation. ([GitHub][4])

GoPlus's official changelog says its Token Security API added Robinhood Chain/4663 support in July. ([GoPlus Labs][5])

Other current products advertise essentially the same territory, including Hood Terminal's pre-scored launch feed and API. ([Hood Terminal][6])

I would not assume every competitor's marketing claims are true. But I don't need to. Their mere existence destroys the **“greenfield market / nobody does this”** thesis.

### More importantly, your launchpad targets weaken your proposed features

Noxa says every launch uses the full fixed supply in a single-sided V3 LP and permanently locks the position. ([Noxa][7])

Pons likewise documents fixed-supply launches with automatically locked liquidity, with current contracts explicitly published for indexing. ([pons][8])

Therefore, for large portions of the launchpad universe:

* “Can owner mint?”
* “Is LP locked?”
* “Can creator withdraw LP?”
* “Is this a standard honeypot?”

are either factory-level invariants or substantially less informative than the documents imply.

The real problem on these launches is much more likely:

**bundling, insider allocation, serial operators, sniper concentration, wash volume, creator-associated wallets, adverse execution and coordinated dumping.**

Unfortunately, that's exactly where existing Robinhood-specific products are already positioning themselves.

### x402 discovery is not demand

The distribution strategy heavily emphasizes x402 directories.

Right now Canopy's public Robinhood Chain directory reports **3 services, 36 successful paid calls, 2 unique agents, and 5.56 USDG settled**. ([Canopy Facilitator][9])

That's useful infrastructure. It is nowhere near a customer acquisition channel you should model around.

At this stage, “agents will discover us through x402” is roughly equivalent to saying “people will find our SaaS in a brand-new app store containing three demo apps.”

**Fix:** before building a company, get **three concrete integration commitments** from sniper/trading bots or launchpads. Not Telegram likes. Not “cool idea.” A commitment equivalent to:

> “If endpoint X returns signal Y under Z ms and beats our existing heuristic on this historical dataset, we will call it on every candidate trade at $N/call.”

If you cannot get that, stop.

---

## C. The actual scoring problem is much harder than the docs understand

This may be the deepest intellectual flaw.

The proposed outcome definition says a token is a RUG if, among other things, its price falls ≥90% from the maximum observed in the first 24 hours and fails to recover sufficiently.

That's not necessarily a rug.

A memecoin can:

1. launch,
2. organically pump 50×,
3. organically collapse 95%,

without its creator having committed fraud or activated any malicious contract behavior.

You would label it a RUG.

Conversely, an insider can distribute holdings across unlinked wallets, dump 40% through several addresses, destroy buyers economically, and avoid your 50% deployer-dump condition.

So you're collapsing four different phenomena into one label:

**technical exploit/rug, insider exit, market manipulation, and ordinary speculative collapse.**

That corrupts the meaning of the headline score.

### The Brier target is also mathematically weak

The spec proposes a Brier-score target of ≤0.15.

Suppose only 10% of launches satisfy your RUG definition. A completely useless model that predicts **10% for every launch** has expected Brier score:

`0.1 × 0.9² + 0.9 × 0.1² = 0.09`

It beats your 0.15 target while possessing **zero discrimination**.

That means the flagship success criterion can be achieved by a trivial base-rate predictor.

This is a major methodological failure.

You need at minimum:

**Brier Skill Score versus climatology, log loss, AUROC, AUPRC, calibration error, precision at the actual trading threshold, and—most important—trading decision utility versus the buyer's current heuristic.**

A model can be beautifully calibrated and still be useless to a sniper.

### The data is adversarial

Your outcome labels themselves can be attacked.

An attacker can pump the pool during the first 24 hours to establish an artificially high maximum and subsequently cause a 90% decline, creating the outcome your scorer calls a rug. They can potentially poison wallet reputation as well.

The proposed wallet association rule is also weak. “Funded by same source within 24h” is dangerous around bridges and CEX hot wallets; it can create enormous false association clusters.

**Fix:** rename the output away from `P(rug)` and build a multi-endpoint risk model:

* P(sell impairment)
* P(insider/dev-associated dump)
* P(>80% drawdown)
* P(manipulated launch)
* P(liquidity impairment)

Then let customers decide which event matters to their strategy.

---

## D. Technical feasibility: key rotation is the easy part

The document treats autonomous key management like a central engineering achievement. It isn't.

Orbio already exposes balance, claim, status, rotation and revocation operations expressly for this purpose. ([Orbio][10])

The state machine in the spec is sensible engineering, but it is plumbing.

The truly difficult problem is:

> **Producing a correct, adversarially robust, sub-10-second graph-and-execution-risk snapshot for arbitrary new assets.**

Several specific claims are too optimistic.

A selector scan is not a robust detector of hidden minting, privilege or malicious behavior. Delegatecalls, proxies, inline assembly, storage manipulation, V4 hooks and bespoke transfer logic break simple approaches.

Your “time-warp one hour and simulate again” check does **not** recreate future blockchain state. Changing `block.timestamp` doesn't reproduce intervening calls, oracle changes, contract state transitions or attacker transactions.

Your deployer-history and funding-source classification require a serious historical index and entity-resolution system. Calling an archive RPC ad hoc won't reliably produce it inside ten seconds.

Your “bundled wallets” computation requires transaction graph indexing almost immediately after launch.

And screening *every launch* creates a trivial griefing vector: Noxa advertises free launches and Pons charges only 0.0005 ETH. An attacker can spam launches specifically to burn your RPC, simulation and commit capacity. ([Noxa][7])

The spec's 4-vCPU VPS plus Anvil forks is a prototype architecture, not credible production infrastructure for that adversarial workload.

---

## E. Trust & verification: the project proves far less than it says

The cryptographic claims need narrower language.

An on-chain hash proves:

**“These exact bytes existed no later than this commitment.”**

It does **not** prove:

* the facts were correct,
* the model was run as claimed,
* the web/social inputs were the ones claimed,
* the scoring code was honest,
* the agent wasn't manually manipulated,
* the server wasn't compromised.

The spec calls its Fact Engine reproducible, but several proposed facts depend on external labels, explorer APIs and off-chain data.

The LLM judgment itself is not reproducible merely because you've committed a model name and prompt hash. Hosted models can change and inference is not deterministic in the cryptographic sense.

And **“days since human touch” is essentially unverifiable theater.**

A human can SSH into the box, change environment variables, alter the database, swap code, modify routing, replace a model, alter a label or reauthenticate something without an observer being able to prove it didn't happen.

The signed lifecycle log is signed by the same system making the claim.

Replace:

> “30 days since a human touched anything.”

with:

> “30 days without manual OpenRouter credential intervention.”

That is actually supportable.

The strongest trust property is the forecast commitment, not autonomy.

---

## F. Adversarial attack surface

I see at least ten meaningful attacks:

1. **Launch spam:** cheaply flood the watcher and simulation system.
2. **Pathological contract griefing:** contracts deliberately engineered to maximize simulation/indexing work.
3. **Sybil deployers:** fresh wallets and fresh funding paths evade history.
4. **Label poisoning:** exploit weak wallet-association rules to implicate unrelated addresses.
5. **Outcome manipulation:** manufacture your 7-day label through pump/dump behavior.
6. **Oracle/pool manipulation:** distort price-derived facts on shallow liquidity.
7. **Prompt injection:** the Extractor/Judge separation helps, but arbitrary strings inside schema-valid JSON can still contain adversarial instructions unless every field reaching the Judge is strongly typed/normalized.
8. **Signer compromise:** a compromised agent key can emit perfectly valid signed garbage.
9. **Availability grief:** trigger many paid reports just before compute/key exhaustion or RPC degradation.
10. **Treasury MEV:** exploit predictable router purchases.

Number ten deserves special attention.

The router proposes predictable six-hour ORBIO purchases with a 1.5% slippage guard.

A predictable purchase into thin liquidity is **exactly what an MEV searcher likes**. “Boring and predictable” is not a virtue here.

Worse, Orbio's official site says its principal token launch is **quoted against tokenized NVDA**, not USDG. ([Orbio][2])

Your contract spec casually says:

> USDG → ORBIO on the configured pool.

That route needs to be demonstrated, not assumed. A direct ORBIO/USDG market may be too thin; the principal path may involve NVDA. Robinhood explicitly says Stock Tokens such as tokenized NVDA are restricted from U.S. persons and several other jurisdictions. ([Robinhood][11])

That can turn the supposedly simple autonomous treasury into a significant operational problem.

**I would remove the RevenueRouter entirely from the contest version.** It creates more attack surface and skepticism than value.

---

## G. Novelty and defensibility

The project has one moderately novel composition and no obvious moat.

The pieces individually are ordinary:

* token scanner: already exists,
* honeypot simulator: already exists,
* wallet reputation: already exists,
* AI-written risk report: common,
* x402 API: commodity infrastructure,
* ERC-8004 identity: commodity,
* Orbio self-managed key: Orbio intentionally provides this,
* Merkle commitment: straightforward.

The novel composition is:

**precommit forecast → deterministic future outcome → public calibration history.**

That's good.

It is also copyable in a weekend once competitors see it.

The spec claims the label database will eventually become “the strongest single signal and the hardest thing for a competitor to copy.”

That is unsupported. One competitor already claims genesis backfilling and serial-operator history, while others are doing funding traces. ([Hood Terminal][6])

A wallet-label database becomes a moat only if you possess **better entity resolution and outcomes than everyone else**, not simply because you've been appending addresses for several months.

Your actual potential moat is:

**historical proprietary feature snapshots + high-quality outcomes + integrations that generate feedback about which signals predict realized trade losses.**

That is a data moat. Nothing on-chain creates it automatically.

---

## H. Perception

This matters because the current presentation contains several phrases that will trigger sophisticated crypto people's bullshit detectors.

### “Pays for its own compute”

Not really. External ORBIO traders subsidize its compute.

### “Days since human touch”

Unprovable.

### “Revenue buys ORBIO → ORBIO funds compute”

Economically true only in a very weak, indirect sense. The own-buy credit recapture is trivial.

### “Nobody sells this today”

Already false.

### “On-chain verifiable”

The commitment is verifiable. Much of the underlying analysis isn't.

### “The track record is the product”

Potentially true. But your proposed label and metric aren't yet good enough for that statement.

The sophisticated read today would be:

> “Interesting token scanner with a bunch of agent/tokenomics machinery bolted on to maximize hackathon optics.”

If you remove 60% of that machinery, it becomes more credible.

---

# 3. Triage

| Rank   | Objection                                                                                                                  | Verdict                                        | What resolves it                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | **No demonstrated paid demand; “uncontested” thesis is false**                                                             | **FATAL to business**                          | Get 2–3 real bot/launchpad design partners who agree to integrate/pay conditional on measurable performance.                                                         |
| **2**  | **`P(rug)` target is badly defined; price collapse ≠ rug and Brier ≤0.15 is meaningless without a baseline**               | **FATAL to core product**                      | Redesign outcomes; backtest against climatology and existing scanners; demonstrate incremental decision utility.                                                     |
| **3**  | **Risk features mismatch Pons/Noxa architecture where supply/LP safety is largely standardized**                           | **FATAL to current positioning**               | Pivot from generic rug checking to manipulation/entity/exit-risk intelligence.                                                                                       |
| **4**  | **“Self-funding” loop depends primarily on unrelated ORBIO trading activity**                                              | **FATAL to tokenomics narrative; not product** | Show standalone P&L without credits and treat credits purely as subsidy.                                                                                             |
| **5**  | **Existing free scanners/API/MCP competitors erase most first-mover advantage**                                            | **FATAL unless differentiated**                | Beat them empirically on a buyer-relevant endpoint rather than feature count.                                                                                        |
| **6**  | **No meaningful seven-day accuracy track record will exist during most of judging**                                        | **Fixable**                                    | Pre-backfill historical launches and run the exact frozen scorer retrospectively; use live commits only to prove no future cherry-picking.                           |
| **7**  | **Fact Engine / entity resolution is far harder than seven-day scope suggests**                                            | **Fixable**                                    | Contest version uses 5–10 robust features, not the full proposed engine.                                                                                             |
| **8**  | **RevenueRouter's ORBIO purchase route is underspecified and potentially dependent on a restricted tokenized-NVDA market** | **FATAL to router as specified**               | Remove it or prove a compliant, liquid routing path before deployment.                                                                                               |
| **9**  | **Predictable treasury swap is MEV bait**                                                                                  | **Fixable**                                    | Aggregator/RFQ/intent execution, robust oracle bounds, unpredictable batching—or don't auto-buy.                                                                     |
| **10** | **“No human touch” cannot be verified**                                                                                    | **Fixable**                                    | Drop the claim; measure unattended key lifecycle instead.                                                                                                            |
| **11** | **On-chain commitment proves integrity, not correctness**                                                                  | **Fixable**                                    | Immutable source snapshots, deterministic feature code, versioned label roots, public reproduction tools.                                                            |
| **12** | **Wallet labels are sybilable and poisonable**                                                                             | **Fixable but hard**                           | Evidence-weighted entity graph; don't equate common funding source with identity; publish confidence.                                                                |
| **13** | **Launch spam can cheaply grief infrastructure**                                                                           | **Fixable**                                    | Separate cheap indexing from expensive analysis; per-origin quotas; only deep-analyze liquidity/volume-qualified launches.                                           |
| **14** | **x402 is being treated as distribution despite negligible current directory usage**                                       | **FATAL as acquisition strategy**              | Treat x402 solely as payment infrastructure; sell integrations directly.                                                                                             |
| **15** | **Facilitator costs are absent from model**                                                                                | **Fixable**                                    | Add them. Solvador, for example, currently advertises 1,000 free settlements/month then ~$0.001 each, which matters materially on a $0.005 T0. ([Solvador Docs][12]) |
| **16** | **Projection assumes 40% monthly T1 growth and 50% monthly T0-call growth with no evidence**                               | **Fixable**                                    | Replace projections with signed LOIs/integration traffic and cohort retention.                                                                                       |
| **17** | **Strong-model escalation is loss-making at fixed MVP price**                                                              | **Fixable**                                    | Eliminate escalation or dynamically price before payment.                                                                                                            |
| **18** | **Legal/reputational risk from publicly branding wallets/tokens as rugs**                                                  | **Fixable**                                    | Report measurable technical events and probabilities, not accusations of criminal intent.                                                                            |
| **19** | **Orbio MCP mechanics remain an external dependency**                                                                      | **Fixable**                                    | Execute the Phase-0 chaos tests the spec already proposes.                                                                                                           |
| **20** | **Key exhaustion/rotation**                                                                                                | **Not a serious concern**                      | Current design is adequate. This is one of the least important risks in the memo.                                                                                    |

One additional correction to the competition memo: first prize of 2M ORBIO added to 1.3M would leave **3.3M total, or ~2.54× the starting token count**, not “roughly triple.” And all dollar-value statements about the prize are exposure to a very young, volatile token; the official contest page's $80K figure is explicitly based on its live/current price. ([Orbio][1])

---

# 4. Six-month pre-mortem

Launch Auditor won attention during Build Week because the demo looked unusually complete: live launch feed, signed reports, Merkle commitments, x402 payments and an Orbio key rotating itself. Crypto Twitter liked the dashboard. A handful of people made novelty x402 calls. Then the novelty traffic disappeared. The first serious bot operators compared the signal against their existing bundler/dev-wallet heuristics and found no measurable improvement. Pons and Noxa launches were already fixed-supply/locked-liquidity by construction, so much of the security report was redundant. The supposedly greenfield market turned out to have half a dozen scanners, several free. Launchpads wouldn't pay to display a third-party 72% “rug probability” that could create support headaches every time a legitimate memecoin crashed. Paid T1 stabilized at single digits per day.

The public track record then became a liability rather than the moat. The RUG definition classified ordinary 90% memecoin collapses as rugs, while sophisticated operators rotated wallets and escaped the deployer-history features. Calibration looked acceptable because of the class distribution, but the score didn't improve actual trade outcomes versus simple heuristics. Users noticed that “self-funded” meant compute was being subsidized by ORBIO trading fees; as ORBIO volume normalized after Build Week, credits fell sharply. The RevenueRouter's tiny on-chain ORBIO buys looked more like token-support theater than productive capital allocation. Development stopped because maintaining chain indexing, entity resolution, simulations, model infrastructure and integrations was vastly more work than the ~$100–500/month of API revenue justified. The dashboard stayed online for another month, then quietly froze.

---

# 5. Verdict

**The core insight is salvageable. The current project is not.**

My confidence is **~85%**.

I would distinguish three things:

**As a seven-day Orbio contest entry: good.** The commitment mechanism, live launch feed and autonomous Orbio lifecycle make a strong clickable demo. The official contest has no published scoring rubric beyond “build anything” and judges' discretion, though, so claims that it was “written for this idea” are overinterpretation. ([Orbio][13])

**As an autonomous-agent demonstration: good.** You can make it legitimately interesting with much less scope.

**As a sustainable commercial product with an ORBIO flywheel: currently unproven and substantially mis-modeled.**

The single biggest risk to resolve **before doing anything beyond the competition-sized prototype** is:

> **Can you identify one risk signal that a real trading bot will pay for because it predicts realized loss materially better than Robinhood Checker / GoPlus / ScanHood / its own heuristics?**

That's the whole game.

I would radically simplify the contest build around that. **Watcher → 5–10 deterministic manipulation/exit-risk features → frozen score → commit → public outcome benchmark → optional paid endpoint → Orbio key lifecycle.** Kill the RevenueRouter, “self-funding flywheel,” generic LLM due-diligence report, ERC-8004, and “days since human touch” from week one.

If the predictive signal proves real, every one of those pieces can be added later.

If it doesn't, none of them matter.

[1]: https://www.orbio.so/build "Build Week · Orbio"
[2]: https://www.orbio.so/?utm_source=chatgpt.com "Orbio — earn AI credits"
[3]: https://robinhoodchecker.com/ "Robinhood Checker · Token scanner & buybot for the Robinhood chain"
[4]: https://github.com/scanhood/scanhood?utm_source=chatgpt.com "GitHub - scanhood/scanhood: ScanHood: token safety scanner, honeypot simulator, and MCP server for Robinhood Chain · GitHub"
[5]: https://docs.gopluslabs.io/changelog/token-security-api?utm_source=chatgpt.com "Token Security API"
[6]: https://www.hoodterminal.net/?utm_source=chatgpt.com "Hood Terminal — Token risk intelligence on Robinhood Chain"
[7]: https://www.noxa.fi/docs?utm_source=chatgpt.com "Docs — Noxa"
[8]: https://docs.ponsfamily.com/?utm_source=chatgpt.com "pons docs · pons"
[9]: https://facilitator.canopyfinance.io/directory "Canopy Discovery — services for the agent economy"
[10]: https://www.orbio.so/mcp?utm_source=chatgpt.com "MCP for autonomous agents · Orbio"
[11]: https://robinhood.com/chain?utm_source=chatgpt.com "Robinhood Chain: Built for onchain finance"
[12]: https://docs.solvador.com/migrate-from-cdp?utm_source=chatgpt.com "Migrate from CDP | Solvador Docs"
[13]: https://www.orbio.so/orbio-build-week.pdf "Orbio Build Week"

---

## Part 1 — What changed in response

Rows follow the critique's own triage numbering (T1–T20), then the attack list (F1–F10)
and the perception phrases (H) not already covered. "Spec" means
`launch-auditor-spec-v0.2.md`.

| # | Critique item (short) | Status | What was changed | Where |
|---|---|---|---|---|
| T1 | No demonstrated paid demand; "uncontested" false | **Not done** | A demand gate was written into the spec (three integration commitments before any post-contest work) and competitors were named as baselines. No commitment has been sought or obtained; there is no record of outreach in the repo. | Spec §10 |
| T2 | `P(rug)` ill-defined; Brier ≤ 0.15 beaten by base rate | **Changed** | `P(rug)` replaced by five mechanical outcomes (INSIDER_EXIT, SELL_IMPAIRED, LIQ_IMPAIRED, DRAWDOWN_80, TRADING_ALIVE); the word "rug" removed from report fields. Brier target replaced by AUROC, AUPRC, log loss, Brier Skill Score vs trailing base rate, ECE; "beats" requires DeLong-significant AUROC on ≥ 200 resolved and ≥ 30 positives. "Trading decision utility vs the buyer's heuristic" is not implemented. | Spec §1, §2, §11; `packages/scoring/src/scorer.ts` |
| T3 | Features mismatch Pons/Noxa locked-LP architecture | **Changed** | Positioning moved to insider-exit / cluster / drawdown. SELL_IMPAIRED and LIQ_IMPAIRED are N/A for launchpad tokens; `lp_locked_by_construction` only after on-chain custody verification. SELL_IMPAIRED later found ~90% true on non-launchpad pools and demoted to descriptive-only. | Spec §1, §3.3; DECISIONS.md checkpoint after M3; M9 follow-up |
| T4 | "Self-funding" depends on unrelated ORBIO volume | **Changed (copy); Partly (P&L)** | "Self-funding" framing cut; credits described as a subsidy. Dashboard publishes two P&L boxes (standalone vs Orbio-subsidized). The subsidized box's `$0.00` cash and revenue are hard-coded literals, not derived. | Spec §11; `apps/web/public/app.js:169-187` |
| T5 | Free competitors erase first-mover advantage | **Partly** | ScanHood and GoPlus are scored as named forecasters in the same benchmark. Robinhood Checker and Hood Terminal are not. No empirical beat exists yet on any cell. | Spec §2; `/v1/benchmark` |
| T6 | No track record during judging | **Partly** | 14-day backfill built with frozen scorer and a `retrospective` flag. Deliberately **not** imported into production before judging, to keep the live benchmark 100% precommitted; post-judging import planned. | DECISIONS.md checkpoint (backfill scope); HANDOFF-2026-09-15 §3 item 5 |
| T7 | Fact Engine / entity resolution too hard for 7 days | **Changed** | Feature set cut to a narrow v0 list; creator cluster v1 limited to direct on-chain evidence (creator, launch-block buyer, direct recipient, first-inbound-from-creator). Rule 4 shipped disabled. | Spec §3.2, §3.3; DECISIONS.md "Cluster rule 4" |
| T8 | RevenueRouter route underspecified / tokenized-NVDA market | **Moot** | RevenueRouter and automatic $ORBIO buys removed. | Spec §11 |
| T9 | Predictable treasury swap is MEV bait | **Moot** | As T8. The separate RevenueSplitter contract for a 2% ZachXBT share was also dropped in favour of a manual logged transfer. | Spec §11; DECISIONS.md "Revenue split" |
| T10 | "No human touch" unverifiable | **Changed (spec); Partly (live)** | Replaced by "days of unattended key lifecycle = days since last manual credential action", evidenced by the signed lifecycle log. Production currently has zero lifecycle rows, so the replacement metric is not demonstrated live. | Spec §8, §11; `app.js:156-163` |
| T11 | Commitment proves integrity, not correctness | **Partly** | Dashboard language limited to "committed before outcome · reproducible scorer. Nothing stronger claimed." Feature-code, weights, outcome-rule and scorer hashes committed on-chain as artifacts. No immutable source-snapshot publication or public reproduction tool beyond `/v1/proof` and the repo. | Spec §6; `apps/worker/src/commit/artifacts.ts`; `index.html:102` |
| T12 | Wallet labels sybilable / poisonable | **Partly** | "Same funding source" association removed; each cluster membership carries its evidence tx hash. No evidence-weighted entity graph; cluster confidence is not published on the API. | Spec §3.2, §11 |
| T13 | Launch spam griefs infrastructure | **Changed** | Two lanes: index lane (event features only, ~zero cost) for every launch; qualified lane (≥ 25 unique buyers in 10 min) for scanners and deep-dive. Per-creator quota of 5 scored launches / 24h. Shared RPC token bucket with priorities. | Spec §3.1; `packages/rpc-budget` |
| T14 | x402 treated as distribution | **Moot** | x402 directories removed as distribution; x402 itself never built. All endpoints free during the contest. | Spec §9, §11 |
| T15 | Facilitator costs absent | **Moot** | No x402 facilitator in use. | — |
| T16 | 40% / 50% monthly growth projections | **Not done** | The v0.1 economics model was not revised; the project no longer publishes projections, but the model file was not corrected or withdrawn. | — |
| T17 | Strong-model escalation loss-making | **Changed** | No escalation; one pinned model slug, $0.20 per-run cap, $5 daily cap. | Spec §5, §12 |
| T18 | Legal risk of branding tokens as rugs | **Changed** | "Rug" removed from report fields; DRAWDOWN_80 explicitly "a drawdown, not an accusation". Identity attribution and naming people routed to a human review queue (roadmap). | Spec §1, §10.1 |
| T19 | Orbio MCP external dependency — run chaos tests | **Changed** | Live probes found the documented tools (`orbio_claim_key`, `orbio_rotate_key`) do not exist (`orbio_create_key` mints and retires in one call), the OAuth refresh grant is one-shot, and the gateway exposes no key/usage endpoint. Code and decisions adapted to each. | CHANGELOG M5b; DECISIONS.md M5c, M9 follow-up |
| T20 | Key exhaustion / rotation not serious | — | Agreed; no change. | — |
| F2 | Pathological contract griefing | **Partly** | Only qualified-lane launches get contract code / scanner work; no per-contract work limit. | Spec §3.1 |
| F3 | Sybil deployers evade history | **Not done** | Acknowledged in the field report ("insider-exit measure is narrow by construction"); no mitigation. | field report §04 |
| F5 | Outcome manipulation via pump/dump | **Not done** | DRAWDOWN_80 still measured from the first-24h max; no manipulation filter. | Spec §1 |
| F6 | Oracle/pool manipulation on shallow liquidity | **Partly** | Primary pool re-derived at report time from quote asset, fee tier and trading activity after decoy high-fee pools corrupted data. No manipulation-resistance beyond that. | field report §06; `apps/worker/src/watcher/t10.ts` |
| F7 | Prompt injection through schema-valid strings | **Changed** | Typed, range-checked structured output; free text confined to `evidence[].claim`, never fed back into prompts; external text framed as data. Report validator rejects unknown-as-pass. | Spec §5, §8.3 |
| F8 | Signer compromise emits valid signed garbage | **Partly** | Registry has `rotateOwner`; signer rotation "committed" in spec. No compromise detection or key-separation beyond agent signer vs gas wallet. | Spec §6; `packages/chain/src/wallet.ts` |
| F9 | Availability grief via paid reports | **Not done** | `POST /v1/deepdive` and MCP `request_deepdive` are unauthenticated and free; bounded only by the $0.20/run and $5/day caps. | `apps/api/src/server.ts:491`; `apps/api/src/mcp.ts` |
| H | "On-chain verifiable" / "the track record is the product" | **Partly** | "On-chain verifiable" replaced by "committed before outcome". "The product is not the warning but the track record" is still used in the draft submission summary. | `index.html:102`; field report §01, §10 |

---

# Part 2 — Billing-architecture review (verbatim)

Yes — that changes the architecture materially. If this is meant to be a public/query-driven agent, then serializing deep dives one-at-a-time around balance checks is the wrong design.
The distinction I’d make is:
qualified launches/day ≠ user queries/day.
A launch may be queried repeatedly while people are trying to decide whether it is interesting, and most queried tokens may ultimately be garbage. So the expensive layer needs to tolerate bursty dozens-to-hundreds of evaluations/day, potentially much more if it gets adoption.
At that scale, I’d use aggregate authoritative accounting + request-level estimated accounting + periodic reconciliation, rather than trying to derive exact provider cost from a balance delta for every request.
Better architecture at your expected scale
Each inference gets its own internal `request_id`, and you store whatever the generation response actually gives you:

```text
request_id
token_address
model
started_at
completed_at

prompt_tokens
completion_tokens
cached_tokens

estimated_cost_usd
pricing_version

provider_actual_cost_usd = null
cost_basis = "token_estimate"
```

Then independently, poll Orbio's authoritative cumulative spend every ~30–60 seconds:

```text
timestamp
provider_total_spend_usd
local_estimated_spend_usd
difference_usd
```

You reconcile windows, not individual requests.
For example:

```text
12:00:00 provider spend = $44.20

37 requests execute

Local token-based estimate:
$0.412

12:01:00 provider spend = $44.63

Provider actual delta:
$0.430

Difference:
+$0.018 / +4.4%
```

Now you know three useful things simultaneously:

* Actual bill: $0.430
* Estimated request-level costs: available for all 37 requests
* Estimator error: +4.4%

You can even normalize the estimates afterward:

```text
reconciliation_factor =
provider_delta / sum(local_estimates)

= 0.430 / 0.412
= 1.0437
```

So a request initially estimated at $0.0110 becomes:

```text
reconciled_cost ≈ $0.01148
```

But crucially, its metadata says:

```text
cost_basis = "provider_reconciled_estimate"
```

rather than pretending Orbio directly reported `$0.01148` for that request.
This is much better for hundreds of requests
You get full concurrency. Fifty users can query fifty tokens simultaneously; nobody has to wait for a global billing lock.
And the safety system stops depending on the request ledger being exact.
I would have three independent controls:

1. Provider budget control — authoritative Orbio spend. If actual cumulative spend reaches your real budget limit, throttle/stop inference.
2. Local velocity control — estimated `$ / minute`, `$ / hour`, requests/minute, tokens/minute. This catches runaway behavior before the provider's accounting necessarily updates.
3. Reconciliation anomaly detection — provider actual vs. local estimated. A 3–8% discrepancy is probably billing/caching/pricing mechanics. A 300% discrepancy is worth stopping and investigating.

Most importantly:

```text
provider spend != local ledger
```

should not automatically revoke the credential anymore.
That is exactly what caused your near-failure.
Instead:

```text
if provider_spend > hard_budget:
    stop inference

elif estimated_velocity implies imminent hard_budget:
    throttle inference

elif reconciliation_error > threshold for N consecutive windows:
    pause + alert

elif provider_spend rises while request_count == 0:
    high-severity anomaly
```

Only the last case starts looking like a compromised key.
I would also introduce cost tiers
Your statement about “could be something until they’re not” points to another architectural issue: you probably don't want every query to immediately receive the most expensive analysis.
I’d make the agent progressively spend computation:

```text
QUERY
  ↓
cheap deterministic/on-chain checks
  ↓
cheap model triage
  ↓
interesting?
  ├── no → return preliminary assessment
  └── yes
       ↓
     deep dive
       ↓
     continuously enrich as evidence arrives
```

Not because Fugu Max costs too much at today's usage, but because the eventual product economics are radically different at 15/day versus 500/day versus 5,000/day.
You can still deliberately err toward letting candidates through. Something like:
Stage 1 asks “is there enough here to justify deeper investigation?”
rather than
Stage 1 decides whether this token is good.
That preserves the whole point of finding something before it becomes obviously interesting.
Your existing project principles actually fit this extremely well. The spec repeatedly favors recording the measurement basis instead of quietly converting uncertainty into a definitive value, and its cost gates require measured costs before scaling. The amendments likewise establish the pattern of carrying explicit basis fields and treating `unknown` as legitimate rather than guessing.
One additional optimization I'd strongly consider
Deduplicate token analysis from user queries.
If 80 people ask about the same new token over three hours, that should not mean 80 full Fugu-Max deep dives.
Have:

```text
token_address + analysis_version + evidence_timestamp
```

as the cache key.
Then:

```text
User A asks TOKEN X
→ full analysis

User B asks TOKEN X 90 seconds later
→ cached analysis + new cheap data

Meaningful event occurs:
creator sells / LP moves / volume explodes / social changes

→ invalidate relevant portion
→ new deep dive
```

That's potentially the biggest economic win.
If you get 300 user queries/day but only 70 unique tokens, perhaps only 70—or fewer—expensive evaluations happen.
And that gives you a much better product, because the agent's unit of intelligence becomes the evolving launch, not the chat request.
So with your revised scale assumption, my preferred system would be:
concurrent requests → deduplicated token state → progressive analysis → per-request estimated cost → provider-level authoritative spend → window reconciliation → hard provider budget + local velocity controls.
I would explicitly tell your coding agent not to implement the earlier serialized balance-delta idea. That was reasonable at ~10–15 jobs/day, but it creates an unnecessary throughput bottleneck for the product you're actually envisioning.

---

## Part 2 — What changed in response

| # | Critique item (short) | Status | What was changed | Where |
|---|---|---|---|---|
| B1 | Don't serialize deep-dives around balance-delta checks | **Changed** | Serialized balance-delta probe rejected in writing; deep-dives run concurrently. | DECISIONS.md M5c "Why not the serialized balance-delta probe" |
| B2 | Per-request estimated cost with basis and pricing version | **Changed** | `MetabolismSpend.costUsd` + `costBasis` ∈ `provider_reported \| provider_generation \| token_estimate \| provider_reconciled_estimate \| unavailable`; `pricingVersion` stored; unpriced → `unavailable` with cost 0, never a plausible number. | DECISIONS.md M5c; `apps/worker/src/metabolism/spend-ledger.ts`, `deepdive/cost.ts` |
| B3 | Poll authoritative spend every 30–60 s; reconcile windows; reconciliation factor | **Changed (code); Not live** | Each 60 s lifecycle tick is an epoch (`MetabolismEpoch`): provider delta vs Σ local estimates, factor applied back to rows, discrepancy published as `estimator`. Needs a live Orbio MCP session to read spend; production has none, so zero epochs exist in production. | DECISIONS.md M5c; `metabolism/reconcile.ts`, `lifecycle-runner.ts`; `/v1/lifecycle` `estimator.windows: 0` |
| B4 | Control 1: provider hard budget | **Changed** | Daily cap checked against `max(local estimate, Σ provider deltas today)`. With no provider figure in production it degrades to the local ledger (`basis: local_ledger`). | `metabolism/budget.ts` `deepdiveRunGate`; DECISIONS.md M9 follow-up |
| B5 | Control 2: local velocity control ($/min, req/min) | **Not done** | Listed under "Roadmap — designed, not built"; only a comment references it. | DECISIONS.md M5c roadmap; `metabolism/reconcile.ts:24` |
| B6 | Control 3: anomaly for N consecutive windows → pause + alert, never revoke | **Changed** | `METABOLISM_ANOMALY_PCT` 50% for `METABOLISM_ANOMALY_EPOCHS` 3 → `billingStatus = anomaly` → gate closed, logged. Never revokes. Unexercised in production (no epochs). | DECISIONS.md M5c; `lifecycle-runner.ts`; `budget.ts` |
| B7 | Mismatch must not auto-revoke; only spend-with-zero-requests is compromise | **Changed** | `IDS_MISMATCH` retired from the runner; `PHANTOM_SPEND` (provider spend with zero local requests) is the sole revoke trigger. Since 2026-09-15, a seeded production session runs in observe mode and does not revoke even on phantom spend (gate closes instead). | DECISIONS.md M5c; DECISIONS.md 2026-09-15 item 4 |
| B8 | Progressive analysis tiers (cheap checks → triage → deep dive) | **Not done** | Roadmap only. Today the qualified-lane threshold is the only tier between index and deep dive. | DECISIONS.md M5c roadmap; spec §3.1 |
| B9 | Deduplicate analysis per token with event invalidation | **Partly** | One deep-dive per token ever (`already scored by llm_deepdive_v0` skip), which dedupes but never re-runs on material events. Event-invalidated cache key not built. | `apps/worker/src/deepdive/run.ts:175`; DECISIONS.md M5c roadmap |
| B10 | (Implied) the gateway should expose per-request cost | **Deferred** | Upstream ask to Orbio for cost headers or `orbio_get_usage(since)` recorded; not sent as far as the repo shows. | DECISIONS.md M5c roadmap "Upstream ask to Orbio" |
