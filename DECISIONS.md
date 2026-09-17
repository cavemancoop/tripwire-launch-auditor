# Decisions

Standing choices that aren't obvious from the code. Newest first.

## det_v0.1: promote four cells, hold SELL_IMPAIRED (2026-09-17)

**Decision.** Applied 4 of the 6 rates from the 2026-09-09 re-featured backfill
to det_v0.1's `biasOverride` (`LIQ_IMPAIRED@24h`, `DRAWDOWN_80@24h`,
`TRADING_ALIVE@24h`; `INSIDER_EXIT@6h/@24h` unchanged from the 2026-09-08
backfill, which that refeature run excluded) and wired `det_v0.1` into
`assemble.ts` so it's built and persisted alongside `det_v0` on every launch
report. `SELL_IMPAIRED@1h/@24h` — measured at ~96% true by that same
backfill — was deliberately left out of `biasOverride` and still reads
det_v0's original hand-set prior.

**Why.** `det_v0` is negative-Brier-Skill on every live cell (confirmed via
`/v1/benchmark`: worst is `SELL_IMPAIRED@1h` at -9.66). `det_v0.1` was
designed and coded for exactly this (checkpoint §8.3, scored as its own
forecaster so "both run live and the tuning is visible" per the code
comment) but was never wired into the report pipeline. Four of the five
newly-measured cells barely move from det_v0's existing prior and aren't
controversial. SELL_IMPAIRED is different: the 96% figure only became
measurable because the same backfill run fixed a wrong-pool quote bug that
had previously contaminated this cell entirely (`resolve-sell-impaired.ts` /
`primary-pool.ts`), and n=53 (~2 negative cases) can't rule out a residual
artifact in that same resolver. Re-running the identical code path at a
bigger sample would be the same unverified claim asserted louder, not
independent confirmation.

**The queued follow-up, and what it actually needs to deliver validation.**
`cohort-extraction` (a separate ~3,500-token dataset at
`~/cohort-extraction`, built for peak-market-cap bucketing from Dune trade
data — unrelated purpose) is a plausible future source of an independent
check, but it computes nothing about sell-impairment today and pressure-test
review (Opus 4.8, 2026-09-16/17) surfaced the conditions that actually make
it useful rather than illusory:
- **Independent pool selection, not a port.** Any sell-impairment check built
  on the cohort must *re-derive* pool selection on its own, then treat the
  already-fixed TS resolver as a cross-check reference, not a dependency —
  do both implementations agree on which pool, for a sample of tokens?
  Copying `resolve-sell-impaired.ts`'s logic wholesale (the natural, tempting
  move — it's the known-good reference) would silently reintroduce the exact
  correlated-error risk this is meant to escape.
- **A Dune-trade-history label and the live-RPC 96% are different
  operationalizations on different substrates**, not two routes to the same
  number — if they disagree, that alone won't say which is wrong (a Dune
  trade record can't see a reverted sell the way an `eth_call` simulation
  can). The real gold standard stays a small (~100-token) ground-truth audit:
  simulate the sell against actual historical pool/router state at the
  launch-window block and compare against both labels.
- **The oft-cited "~140 non-impaired tokens at 4%" is conditional, not free.**
  It assumes the cohort's base rate matches det_v0's live input population.
  If the cohort's inclusion criterion (enough Dune trade history to compute a
  VWAP bucket) systematically excludes fast-dying, thin-history tokens —
  plausibly correlated with sell-impairment — the measured rate describes
  "tokens that survived into a bucket," not launches generally.
- **§A20 may not actually block this.** §A20 is a bucket-*label* fix (which
  SUCCESS/F1/F2 a token lands in); a sell-impairment check is a different
  label over the same token set. If §A20 doesn't change cohort *membership*
  (only re-assigns bucket within it), the sell-check extraction can run in
  parallel with the §A20 pressure test — only a bucket-*stratified*
  discrimination analysis would need §A20 settled first. Confirm which,
  before treating this as a hard serial dependency.

**Consequence.** `det_v0.1` starts accumulating its own live Brier Skill
Score immediately. Nothing changes for what the public feed posts —
`telegram/poster.ts` still hardcodes `det_v0` — until that live data is
reviewed and a separate decision is made to switch.

## Wording pass applied — public copy now matches what's built (2026-09-16, later)

Cooper: "all yes" to every item in `docs/WORDING-PASS-2026-09-16.md`. Applied
to README.md, the spec, and the dashboard's benchmark panel (`d59b531`):

| # | What changed | Where |
|---|---|---|
| 1 | "four" -> "five mechanically-defined outcomes (eleven outcome×horizon cells)" | README §1, spec §0 |
| 2 | Added: "every dollar of compute it has ever spent came from an on-chain CREDIT activation" | README §1 (non-claims paragraph) |
| 3 | "no card, no top-up, no payment rail" -> "...no top-up **from a fiat rail**...", + a pointer to the dashboard's Funding panel | README §8.1 |
| 4 | Property 2 rewritten from the unbuilt "throughput follows token activity and holdings" to the actual live mechanism, `min(dailyCap, 50% of trailing-24h CREDIT activated, balance)`, with the funding-transparency line | spec §0.1 |
| 6 | "one-time browser sign-in — the ONLY interactive step, ever" -> "no browser, no session, ever" (wallet-signed key), old OAuth path kept as a documented fallback | README §8.1 |
| 7 | Property 3 rewritten: "keys drain, rotate at the next accrual" (never true of the wallet-signed key) -> "the key is a standing wallet signature... nothing expires" | spec §0.1 |
| 9 | Added a line explaining "beats X" = DeLong-significant ranking, not calibration — Brier Skill shown alongside for that reason | dashboard benchmark panel (`index.html`) |
| 5, 10 | No code/copy change needed — #5's sentence was already absent from current copy (only in the frozen field report, left as history); #10 was framing, not a factual claim | — |
| 8 | Deferred as already scoped — M10 (DEMO.md, licence, public repo) is its own milestone, not a copy edit | — |

**Deliberately not touched:** the frozen field-report snapshot in
`docs/review-pack/` (explicitly a historical artifact) and the separately
published field-report Claude Artifact — updating the latter is a distinct
publish action, not a repo commit, and wasn't asked for.

Same commit added `docs/STYLE-GUIDE-2026-09-16.md` (visual identity, pulled
from the dashboard's existing CSS tokens, flags the accent-color mismatch with
the field-report artifact) and a tailored video-explainer prompt.

## Found and fixed: property 2 could deadlock a real balance to $0 forever (2026-09-16, same night)

**Found answering Cooper's own question** ("how much CREDIT do we need for
10 days unattended?"). Property 2 makes the daily deep-dive budget
`min(cap, 50% of trailing-24h accrual, balance)`. If accrual hits $0 — which
it does ~24h after the last activation, unconditionally, since the window is
a hard cutoff not a decay — the whole budget is $0 *even with real balance
left*. Spending then stops, balance stops moving, and the agent's own
self-activation (`CREDIT_ACTIVATE=1`) only triggers on *low balance* — which
now never happens. Once the window goes cold there was no path back to warm
except a human noticing. At the account's measured usage (~$0.5-0.8/day) the
default $5 chunk / $2 low-water wouldn't need topping up for 4-5 days —
comfortably enough time for the window to go cold first.

**Fixed:** `activationDecision` gains a keep-warm trigger — activate (still
capped by the same daily cap) once `CREDIT_ACTIVATE_KEEP_WARM_HOURS` (default
20, a 4h margin before the 24h cutoff) has passed since the last self-
activation, balance regardless. Sourced from the local lifecycle log
(Postgres, not a chain scan — cheap every tick), which only sees the agent's
*own* activations; an operator activation the agent doesn't know about just
means it self-activates a bit earlier than the bare minimum, never later —
the safe direction to be wrong in.

**What this means for "how much CREDIT do we need":** the mechanism only
works if the gas wallet holds *unactivated* CREDIT tokens for it to draw on —
Cooper's $20 was activated directly (his CREDIT, beneficiary = gas wallet),
so the wallet itself still holds $0 in plain CREDIT and the keep-warm trigger
has nothing to activate from yet. For genuinely unattended operation, some
CREDIT needs to be sent to the gas wallet as tokens (not pre-activated) —
see the reply to Cooper for a concrete number.

## Dashboard's budget display fixed to match the real gate (2026-09-16, same night)

Caught before Cooper went offline: `apps/api/src/budget-display.ts` is a
deliberately duplicated read-only mirror of the worker's gate (same treatment
as `merkle.ts`) — wiring property 2 into the worker did **not** update it, so
the dashboard would have kept showing a flat `dailyCapUsd: 5` while the real
gate used the accrual-derived figure. At the moment this was caught the two
happened to agree (the $20 activation's 50% share, $10, is still above the
flat $5 cap) — but ~24h after that single activation, the real cap drops to
$0 while the dashboard would have kept saying $5, unexplained, with nobody
watching for the next 10 days.

**Fixed:** `budgetDisplay` takes an optional `creditShareUsd` and adds
`credit_share` as a fourth candidate, mirroring `dailyDeepdiveBudget` exactly.
`/v1/lifecycle` computes it by reusing `/v1/funding`'s already-cached on-chain
scan (`trailingCreditsUsd` added to `FundingSummary`) rather than a second RPC
read. Absent → identical to previous behavior (existing tests unchanged).

## Property 2 wired in: daily budget follows on-chain accrual (2026-09-16)

**Cooper's call:** now that funding is human-gated (he decides when/how much
CREDIT reaches the agent's wallet), sizing the *daily spend* from real accrual
is safe to build now rather than reword as unbuilt. Agreed — the total pool
was already bounded at the funding step; this only changes how much of it the
agent may spend today.

**Built:** `dailyDeepdiveBudget()` (spec §8, `min(dailyCap, 50% of trailing-24h
accrual, balance − reserve)`) was written in M5b but never called — confirmed
dead code by both the earlier grep and Codex. Now: `trailingCreditsUsd()`
sums on-chain `Activated` events with the agent's wallet as beneficiary over a
rolling 24h (any funder — operator or the agent's own future activations), and
`defaultLoadBudget` feeds that into the real gate. Falls back to the flat
`DEEPDIVE_DAILY_CAP_USD` when `ORBIO_CREDIT_ADDRESS` isn't set (unaffected:
local dev, or before this shipped) or on an RPC error (logged, not silent).

**The consequence, stated plainly:** the window is rolling, not a balance. A
single $20 activation ages out of the trailing-24h sum ~24h after it happened,
even though the account may still hold real balance — so without further
funding or the wallet's own staking, this cap trends toward $0 about a day
after Cooper's last activation, and deep-dives throttle down. That is spec §8
working as written ("throughput visibly follows token activity"), not a bug,
but it means the account likely needs a top-up before 10 days pass with nobody
watching it. Flagged to Cooper directly, not just here.

## Report generation was serialized; fixed a 6.8h backlog (2026-09-16)

**Found while verifying the wording pass:** the new `/metrics` freshness
gauges showed `det_coverage_1to2h: 0%` and the newest `det_v0` report's launch
was 6.8 hours old, while reports were still being written every few seconds —
a deep FIFO backlog, not a stall.

**Root cause:** `startFeaturesWorker` (T+10m report generation, the job every
single launch goes through) never set BullMQ's `concurrency` option, so it
defaulted to **1** — one launch processed at a time, unlike `startAssessWorker`
which already set `concurrency: 2`. At ~4 launches/min this was marginal even
before today; it is not new to today's RPC-budget changes, just newly visible
because the freshness gauges didn't exist before this session.

**Fixed:** `FEATURES_CONCURRENCY` (default 8, env-overridable). Every job still
runs through the shared `PRIORITY.watcher` client, so this raises how many run
at once, not their priority against outcomes/deepdive/backfill.

**Also fixed in the same pass:** `apps/api` had no `RH_RPC_URL`, so
`GET /v1/funding` silently reported `configured:false` and `/v1/proof`'s
on-chain confirmation silently degraded to `null`. Set as
`${{worker.RH_RPC_URL}}` (Railway variable reference — the value itself was
never typed or printed here).

**Also noted, not yet acted on:** Postgres volume is at 449/500 MB (90%).
Needs a decision from Cooper before it fills — see the remaining-work list.

## Locked the two spending endpoints (2026-09-16)

`POST /v1/deepdive/{token}` and the MCP `request_deepdive` tool were open to
anyone and each accepted call spends the agent's own Orbio balance (up to
$0.20). With a real balance now, an anonymous caller could exhaust the $5/day
cap. Both now require the `x-api-key` header design partners already send
(`checkDesignPartner`, previously echoed but never enforced). `/v1/assess`
stays free — det_v0/heuristic only, no LLM spend. `GET /v1/report/:token`
still shows whatever `llm_deepdive_v0` result already exists for free; only
*triggering* a new run is gated.

## Live on the agent's own account; epoch rules made lag-aware (2026-09-16)

**Funding landed as an activation, not a transfer.** Cooper activated 20 CREDIT
from his wallet `0x4cb72456e82aeDd8b1ef0F08D03Cc6bFf96c6291` with the gas wallet
as beneficiary — activation #58, tx
`0xb7f87415d3b285c5daf3e94a66453396b3b9452813e557d61a73dca5659e2c24`, block
64,784,388. The agent wallet never held transferable CREDIT, which is strictly
safer than the transfer plan; the agent's own activate path stays armed for
future transfers. Within one tick of `ORBIO_KEY_SOURCE=wallet`: the gas wallet's
signature key authenticated, `STARVED -> ACTIVE: balance recovered to $20.00`,
and the next deep-dive sweep scored 5/5 — the first LLM reports since the old
account hit $0.

**Two epoch rules changed because charges land after the answer they pay for**
(Orbio agents doc §5):
- **Phantom** now requires zero requests in this window *and* the one before
  it. Previously a late charge arriving in the idle window after a sweep would
  read as a compromise; it was only below the $0.005 tolerance by luck of sweep
  cost.
- **Anomaly** is not graded when both provider delta and local estimate are
  under $0.02 (`minGradeUsd`). The first live window was $0.0023 of estimate vs
  $0.00 charged = "-100%"; three of those in a row would have paused inference.

`RESERVE_USD` 3 -> 0.5 on api as well as worker, so the dashboard's spendable
figure matches the gate's.

## Funding the agent: operator-transferred CREDIT, disclosed as a proof of concept (2026-09-16)

**Cooper's decision.** The agent's Orbio account is the **gas wallet**
(`0x9b4EDe199198ca3D41A9a7D2997606BaCd30BA03`). It is funded by Cooper
transferring CREDIT earned by his own staked ORBIO (800k+, which stays in his
wallet). Not by moving ORBIO to the agent: a compromise or bug could lose staked
ORBIO, while the most a compromise can take here is the unactivated CREDIT the
wallet holds — activated balance cannot be transferred or cashed out.

**How it is described publicly (wording to be approved in slice 4):** a proof of
concept — the operator funds the agent's wallet with CREDIT earned from their
own staked ORBIO; activation, budgeting, spending and receipts after that are the
agent's, on-chain. Spec §0.1 property 2 ("throughput follows token activity and
holdings") becomes "throughput follows the CREDIT the agent receives" until the
agent stakes for itself. Autonomous earning (a small stake in the agent wallet,
reversible — no lock-up, see below) is optional and not scheduled.

**Why this is enough:** actual deep-dive spend has been ~$0.44/day (888 requests
/24h), so $20 of CREDIT covers roughly a month; the $5/day cap was never binding.

**Staking terms (read on-chain 2026-09-16, for the day this is revisited):**
`MIN_POSITION` 1,000 ORBIO; `PERIOD` 3600 s; time-weighted rewards; no lock,
cooldown or unlock-time function; `unstake`/`unstakeAll` settle pending CREDIT;
per-staker `claim()` (selector 0x4e71d92d) mints it. Total staked 291.8M ORBIO.
Implementation `0xcd068ca1…36Bd` behind an EIP-1967 proxy.

**Built (slices 2+3, flags off until the CREDIT lands):**
- `ORBIO_KEY_SOURCE=wallet`: at boot the worker signs
  `Orbio API key · chain 4663 · epoch ORBIO_KEY_EPOCH` with the gas wallet;
  that key outranks every other source. Logged only as `sk-orb-0-xxxx…`.
  Before the wallet's first activation the gateway answers 401; the runner
  reads that as balance 0, not an outage.
- `CREDIT_ACTIVATE=1`: when the API balance is below $2 and the wallet holds
  CREDIT, activate min($5 chunk, held, today's remaining cap). The daily cap is
  summed from the wallet's own `Activated` events since UTC midnight, so a
  restart cannot reset it. Pending guard: marked before the tx is sent, cleared
  once the balance reflects it or after 10 min. Each activation is a signed
  lifecycle row with the activation id and tx hash.
- **Allowlist:** the only protocol calls the wallet can make are
  `CREDIT.activate` and `Staking.claim` (`assertAllowedCall`, tested against
  transfer, approve, transferFrom, unstake, unstakeAll, ORBIO.transfer,
  Exchange.buy). There is no code path that moves CREDIT or ORBIO elsewhere.
- **Known gap:** a restart inside the pending window, before the balance shows
  an activation, could activate one extra chunk. Bounded by the on-chain daily
  cap, and the CREDIT is not lost — it becomes the agent's AI balance.
- **Not built yet:** the outflow alert (any CREDIT/ORBIO leaving the wallet other
  than by activation burn).

## Orbio is on-chain now: Metabolism moves off the MCP (2026-09-16)

**What Orbio told us (builders channel, 2026-09-16, dev "yash"):** "for mcp,
reduce relying on it … now that protocol is onchain, you could do without mcp.
top up api key: activate · read balance: api endpoint · api key: sign message
from wallet. so everything is autonomous." Documented at
`https://www.orbio.so/protocol/agents.md` (copied into the evidence below).

**The protocol, as documented and verified on chain 4663:**
- **Key:** the wallet signs `Orbio API key · chain 4663 · epoch N`; the key is
  `sk-orb-{N}-{base64(signature)}`. No key-creation call, no expiry. Rotation =
  a higher epoch, accepted on first use.
- **Balance:** `GET {gateway}/key` -> `balance.available` (activated AI balance)
  and `balance.used` (lifetime usage). Every gateway response carries
  `X-Orbio-Balance` = balance the request started from.
- **Top-up:** `CREDIT.activate(amount)` (6 decimals) burns CREDIT into the
  *calling* wallet's AI balance; emits `Activated(activationId, from,
  beneficiary, amount)`. Or `Exchange.buyAndActivate` with USDG.
- **Accrual:** staked ORBIO earns CREDIT. Observed pattern (last ~6h: 5 mints to
  5 wallets at 5 blocks, 0.06–94.8 CREDIT) = per-staker claims, not an hourly
  airdrop — claiming is a transaction.
- **Contracts (bytecode present, `eth_getCode` 2026-09-16):** CREDIT
  `0xe33322da1380e61e5ae5dfb21e7f62924c73004c` (symbol CREDIT, 6 dec, supply
  218,850); Staking `0xe0710011278bfb63e57c5f227e5980984b1eddca`; Exchange
  `0x6951ffd32630b05e06f50062aea801625a58ebc0` (all three share one 130-byte
  proxy codehash, EIP-1967 slot empty); ORBIO `0xaa07a0e9…28a3` (950M supply);
  USDG `0x5fc5360d…d168`.

**Production finding that forced this now:** the account behind the current key
has `available: 0`. A 1-token request returns `402 insufficient_quota — "This
account has no available balance"`. The deep-dive SDK surfaces that as
"Response validation failed", counted as a per-launch skip, while the budget gate
(no balance source) believed $4.66 remained. `llm_deepdive_v0` has produced no
reports since the balance hit zero. No money lost; the forecaster was dead.
Neither agent wallet (signer `0x6a5A…B4BE`, gas `0x9b4E…BA03`) holds CREDIT,
ORBIO or USDG. Cooper's own wallet holds 800k+ ORBIO, staked and accruing.

**Plan (split per CLAUDE.md):**
1. **Built today:** the lifecycle runner reads balance, lifetime spend and key
   prefix from `GET /key` (`METABOLISM_SOURCE=gateway`, the default). Signed
   lifecycle rows and M5c epochs run in production on the provider's own
   numbers, unattended, with no session. The gateway source has no
   create/revoke, so it always runs in observe mode. Effect with a $0 balance:
   `NO_KEY -> STARVED`, the deep-dive gate closes with "balance is at or below
   the reserve", and the dashboard stops saying "unknown".
2. Wallet-signed key derived at boot from the agent wallet. **Needs Cooper:**
   which wallet.
3. On-chain metabolism: trailing-24h CREDIT claims to the agent wallet feed
   `dailyDeepdiveBudget` (property 2); autonomous claim -> `activate` below
   low-water; activation tx hashes in the lifecycle log. **Needs Cooper:** how
   CREDIT reaches the agent wallet (stake a slice of ORBIO there, transfer
   CREDIT, or buy with USDG) and how much.
4. Dashboard / README / spec wording to match. **Needs Cooper's wording approval.**

**Superseded by this:** the session push (`--with-session`), the session seed,
observe mode as a *security* bound, the "~1h unattended" bound, and the
OAuth-refresh workaround. The code stays until slice 2 lands, then goes.

## GET /api/v1/key works — no MCP session needed to read balance (2026-09-15, later)

**Reported by another builder in the Orbio channel, confirmed against our own
key:** `curl https://api.orbio.so/api/v1/key -H "Authorization: Bearer $ORBIO_API_KEY"`
returns 200, not the 405 the earlier probe found on 2026-09-14. Live response
(2026-09-15, key `sk-orbio-dY3Oyq`, minted 2026-09-12):

```json
{"object":"key","key":{"kind":"secret","prefix":"sk-orbio-dY3Oyq","label":"launch-auditor 2026-09-12","created_at":"2026-09-12T00:39:36.233434+00:00"},
 "balance":{"currency":"USD","available":"0","used":"0.629913","available_micro_usd":"0","used_micro_usd":"629913"},
 "rate_limit":{"requests_per_minute":120,"concurrent":32}}
```

**Why the earlier probe found nothing.** The 2026-09-14 probe hit `/api/key`
(singular) and got 405 (POST-only, `orbio_create_key`'s route). This is
`/api/v1/key` — the OpenRouter-shaped path under the gateway base URL, exactly
as the closer plan speculated (§2.1) and as OpenRouter's own `GET /api/v1/key`
works. Nobody had tried the right path with a live key before.

**What this changes, if the semantics check out:** balance becomes readable
with the gateway key alone — no MCP session, no daily push, no observe-mode
tradeoff. This is potentially the direct fix for property 2 and for the
`balanceUnknown` state on the dashboard, replacing the session-push design
from earlier today rather than supplementing it.

**Not yet wired in — `available: "0"` needs interpreting first, not assuming.**
This is a spend-gate input; getting its meaning wrong is a money-safety bug in
either direction (wrongly halt legitimate spend, or read a false "fine" past a
real problem). Two live-money interpretations are both consistent with a
5-week-old key that has real usage:
- **Per-key allocation, not account balance** — matches the M5b design note
  ("a key holds no money — the account balance IS the quota"); if so
  `available` is the wrong field for the daily-budget gate and the account-wide
  figure (previously only visible via `orbio_get_balance` over MCP) may not be
  in this response at all.
- **Genuinely near-zero account balance** — the $46.10 seen 2026-09-12 minus
  four days of deep-dive spend plausibly lands near zero; `used: 0.629913`
  alone doesn't rule this out.

**Resolved 2026-09-16:** Orbio's agent docs define `available` as the activated
AI balance the key draws from, and a live 402 `insufficient_quota` confirmed $0
means nothing can be spent. It is wired into the runner — see the entry above.

## Outcome resolver: why the backlog keeps growing, and the qualified-only lever (2026-09-15, later)

Raising `OUTCOMES_CONCURRENCY` to 4 made no measurable difference (resolved-per-
minute unchanged; backlog still growing). That itself is informative: the shared
RPC token bucket, not sweep latency, is the constraint — concurrency changes how
many outcomes are in flight, not how many requests/sec leave the process.

**Why INSIDER_EXIT dominates the budget.** Every index-lane launch (spec §1:
INSIDER_EXIT "applies to: all") gets an INSIDER_EXIT row at enumeration
(`ensureOutcomeRows`), qualified or not. Resolving one costs ~80 sequential
`eth_getLogs` calls (cluster-transfer scan); SELL_IMPAIRED costs ~2 quoter
calls. So a handful of INSIDER_EXIT resolutions can spend most of a sweep's
share of the 500 req/min budget, most of it on tokens nobody bought.

**Decision: `OUTCOMES_QUALIFIED_ONLY` (env, default off — current behavior
unchanged).** When on, INSIDER_EXIT/SELL_IMPAIRED/LIQ_IMPAIRED resolve only for
qualified-lane launches (≥$2,000 liquidity-equivalent or ≥25 unique buyers in
10 min, or any paid request — spec §3.1); DRAWDOWN_80/TRADING_ALIVE stay
universal, matching backfill's existing `qualifiedOnly` semantics and its own
documented rationale ("~87% of retrospective launches are spam / token-vs-token
/ >10%-fee side pools whose outcomes are unresolvable and would bias the base
rate"). This does not change what gets *committed* — every det_v0 forecast is
still produced and committed for every launch; it changes which outcomes the
resolver spends RPC budget trying to grade.

**What it leaves uncaptured.** A non-qualified launch's INSIDER_EXIT/SELL/LIQ
rows are still created but never resolved while the flag is on — they sit
PENDING indefinitely rather than counting toward the benchmark. If a thinly-
traded launch's insiders dump, that specific event goes unscored. The rows are
not deleted, so switching the flag off later resolves the backlog rather than
losing it. Enumeration-time skip (never creating those rows) is a further
optimization, not done — the current rows are cheap to store, just not to grade.

**RPC ceiling — confirmed.** Chainstack's dashboard for this node shows 250
requests/**second** (the standard Growth-tier number), not per minute.
`RPC_BUDGET_RPM=500`/min (≈8/sec) was never close to that ceiling — raised to
**3000/min (50/sec, 20% of the hard cap)** on Railway, redeployed. Left
headroom rather than maxing out: Chainstack's monthly request-unit quota for
this plan hasn't been confirmed, and a rate-limit ceiling doesn't rule out a
volume-based cost the account should check before pushing further.

**Qualified-only turned ON** (`OUTCOMES_QUALIFIED_ONLY=1`), per Cooper: launches
under roughly $20k market cap carry risks a buyer should already assume, and an
audit of one on request can be published ad hoc rather than folded into the
scored benchmark. Note this is a different bar from the code's qualified-lane
threshold (≥$2,000 liquidity-equivalent or ≥25 buyers in 10 min, spec §3.1) —
the existing lane definition is what's now gating outcome resolution; nobody
asked to change that number to $20k specifically.

## Outcome resolver: backoff, give-up, fair share across labels (2026-09-15)

Triage item 1 (#3). The live loop swept the 25 oldest horizon-due rows every
minute; 24 of them were SELL_IMPAIRED@1h rows failing an eth_call at the horizon
block, deferred, and re-picked the next minute. ~1 outcome resolved per minute,
so nine of eleven cells never reached the benchmark.

Chosen (operational, reversible; the committed outcome rule is unchanged):
- **Backoff:** a deferred row is not picked again for 30 min.
- **Give-up:** still failing on a transient error 24h after its *first*
  deferral -> `UNRESOLVABLE` with the reason. OUTCOME_RULES_v1 already says a
  failed measurement is unresolvable, never an outcome; UNRESOLVABLE rows are not
  scored. Clock runs from first deferral, not horizon, so backfill rows with
  long-past horizons are not dropped on their first error.
- **Fair share:** the live loop takes oldest-first *within* each label and
  round-robins across labels. SELL_IMPAIRED is descriptive-only; it no longer
  gets to starve the four scoreable outcomes.
- Code-path failures (non-transient) also back off but are never given up on,
  so a fix can still resolve them.
- The raw RPC message behind a "network" quote error is now logged
  (`rpcError`): unrecognised errors default to "network" and were retried
  blind. Classification is unchanged.
- `/metrics` gains per-label `outcomes_pending_due`, `outcomes_deferred`,
  `outcomes_resolved_24h`, so a starved cell is visible without log access.

**Measured after deploy, same day:** the head-of-line block was real but small
(24 retrying rows); the larger limit is throughput. Horizon-due backlog was
~21.6k rows (INSIDER_EXIT 9.5k, SELL_IMPAIRED 9.0k, the three 24h-only labels
1.0k each) against ~900 resolved/24h. With backoff + fair share: 16-20 resolved
per sweep, ~3.5/min, LIQ_IMPAIRED and TRADING_ALIVE +11 each in 15 min (vs 4 in
the prior 24h). One sweep took ~5 min at concurrency 1, so the live loop now
resolves 4 in parallel (`OUTCOMES_CONCURRENCY`); the shared RPC bucket still
caps total calls with watcher and commit ahead of outcomes.

Not claimed: that the nine cells fill this week. They are now reachable; how fast
depends on how many due rows each label has and what the rpcError turns out to be.

## Codex review triage (2026-09-15)

Both phases are in `docs/review-pack/CODEX-REVIEW-2026-09-15.md` (A) and
`…-PHASE-B.md` (B). Rule applied: anything that touches a public claim is fixed
before judging (20 Sep); everything else is deferred with a date. Numbers refer
to Phase B's revised top ten; letters to its §3 "unanticipated" list and the
prior-critique rows it called "only relabeled".

**A builder's finding Codex could not see (worker logs):** the outcome resolver
is head-of-line blocked. It sweeps 25 due rows a minute, oldest horizon first,
and 24 of the 25 are the same SELL_IMPAIRED@1h rows that fail on an RPC error
at the horizon block, get deferred, and are picked again next minute.
Throughput ≈ 1 resolved outcome/min. That, not elapsed time, is why nine of
eleven cells have no data (#3) — and it makes #3 fixable this week.

| Finding | Verdict | One line |
|---|---|---|
| #1 Orbio story absent from production | **Accept** | Run the built session push daily; wire property 2 with `basis`; when the log is empty the panel must say so, not lead. Before judging. |
| #2 `det_v0` miscalibrated (BSS −12.8 / −9.1) | **Accept** | The fix was decided at the post-M3 checkpoint and never applied: `det_v0.1` = intercepts at logit(observed base rate), weights unchanged, versioned and hash-committed; `det_v0`'s record stays as posted. Before judging — the probabilities are public. |
| #3 two-cell benchmark | **Accept** (root cause above) | Back off deferred rows and spread sweeps across cells; expose per-cell pending/deferred/unresolvable counts on `/v1/benchmark`. Before judging. |
| #4 API can't reproduce the benchmark | **Accept, partly** | Read-only `GET /v1/launch/:token` with primary-pool evidence, feature vector + provenance, outcome rows. Before judging if time after #1–#3; a snapshot dataset export is deferred to post-judging (30 Sep). |
| #5 fail-closed observability | **Accept** | Already item 3 on the list: per-catch-site counters + oldest-failure age on `/metrics`, alert on threshold. Fail-closed report generation on pool-selection failure. Before judging. |
| #6 coverage/latency claims exceed measurement | **Accept** | Replace "every launch" / "within seconds" with measured coverage over eligible launches (age ≥ T+10m) and p50/p95 report latency on `/metrics` and in copy. Committed-coverage gauge replaces commit age as the alert. Before judging. Persisting the held tx across restart: deferred (30 Sep). |
| #7 dashboard certainty exceeds data | **Accept** | `$0.00` literals → `n/a` unless derived; "P&L" → "compute cost, trailing 24h"; empty chain renders "no rows", never "verified: yes"; `balanceUnknown` shown in the budget card. Before judging. |
| #8 baseline methodology | **Accept, partly** | Publish overlap n per comparison and add a fixed-window climatology baseline as a named forecaster (`base_rate_fixed`) — the rolling one's AUROC < 0.5 needs explaining before judging, not after. Bootstrap CIs and decision utility: deferred (post-judging). |
| #9 unauthenticated deep-dive endpoints | **Accept — needs Cooper's yes** | Require `x-api-key` on `POST /v1/deepdive` and MCP `request_deepdive`; `/v1/assess` stays free (no spend). Changes a public endpoint, so it is a human checkpoint. |
| #10 narrative inconsistent, demand-free | **Accept (copy) / Defer (demand)** | "four" vs "five" outcomes, "authorize once", "paid entirely", "track record is the product" corrected in README, summary and DEMO.md (M10). Demand commitments were always post-contest (spec §10); no change. |
| §3.7 Telegram "never double-posts" | **Accept** | README wording → "best-effort deduplicated (mark-after-send)". |
| §3.8 `pnpm verify` green with forge skipped | **Accept** | The summary line must say "contract tests NOT run" when forge is absent; README stops claiming full coverage. |
| T1 / F9 (demand, griefing) | as #10 / #9 | — |
| T4 economics "only relabeled" | **Accept (copy)** | As #7. The v0.1 spreadsheet is marked superseded in the planning dir; no replacement model this week. |
| T16 growth projections | **Accept (withdraw)** | Same: mark superseded; nothing is published that depends on it. |
| F3 sybil deployers | **Reject for now** | Disclosure is the honest state; entity resolution is v0.4 Trace. |
| F5 outcome manipulation of the 24h max | **Defer (post-judging)** | Changing an outcome rule mid-record is a human checkpoint and resets the cell; revisit with the SELL_IMPAIRED resize. |
| B5 velocity control, B8 tiers | **Defer (post-judging)** | Roadmap as recorded under M5c. |
| B10 upstream ask to Orbio | **Accept** | Send it (builders channel) — a human action, this week. |
| Closer plan §2.3 "four days clears the bar" | **Withdrawn** | Codex is right: positives, not days, gate INSIDER_EXIT (26/30), and starved cells don't fill with time. |

### Ordered remaining work (replaces HANDOFF-2026-09-15 §3)

1. Resolver backoff + spread (#3) — the cheapest, largest change to the public record.
2. `det_v0.1` intercepts, committed (#2).
3. Dashboard honesty pass (#7, §3.7, §3.8) + copy pass (#6, #10 wording).
4. Coverage/latency gauges and alert (#6); failure counters (#5).
5. Session push run + property 2 with provenance (#1).
6. `/v1/launch/:token` detail (#4); `base_rate_fixed` + overlap n (#8).
7. **Needs Cooper:** #9 auth on deep-dive; B10 message to Orbio; daily `pnpm orbio:auth && pnpm railway:push-env --with-session`; `TELEGRAM_ALERTS_CHANNEL_ID`.
8. M10: DEMO.md, summary, licence, public repo — last, after 1–6 so it describes what is true.

Post-judging (dated 30 Sep): backfill import as `retrospective=true`; SELL_IMPAIRED resize;
F5; B5/B8; snapshot export; bootstrap CIs; held-tx persistence.

## Item 4 — an Orbio session on Railway, and what it may do there (2026-09-15)

**Built, not yet run.** `pnpm railway:push-env --with-session` exists; whether to
use it is the operator's call, because of the cost below.

**The cost, stated plainly.** The token store is a stronger secret than the
gateway key — the key only spends against a capped balance; the session can
mint and revoke keys through the MCP. The seed is encrypted with
`TOKEN_ENCRYPTION_KEY`, which is already on Railway, so both halves sit in one
place. Anyone who can read the worker's env holds a working Orbio session.

**What bounds it.**
- **No refresh token in the seed.** Stripped on the laptop and again at boot.
  The pushed session dies with its access token (~1h) and nobody holding the
  Railway env can extend it. It also cannot race or burn the laptop's one-shot
  refresh grant.
- **No gateway key in the seed.** A container disk is ephemeral and the store
  outranks `ORBIO_API_KEY`, so a seeded key would come back on every restart and
  shadow any newer key pushed later. The key travels only as `ORBIO_API_KEY`.
- **Observe mode (`METABOLISM_KEY_MANAGEMENT=observe`, implied by a seed).** The
  deployed lifecycle loop reads balance and key status and writes signed
  snapshots — which is all property 2 needs — but turns every mint, rotate and
  revoke into a logged `would …` snapshot. A pending mint with the operator's key
  already live is recorded as adopting that key. Without this, the prod loop
  (which starts at `NO_KEY` with an empty lifecycle log) would have minted on its
  first tick, retiring the key both the laptop and `ORBIO_API_KEY` hold, and the
  new key would have lived only on an ephemeral disk.
- **Seed never clobbers.** Written only when no store file exists.

**What observe mode gives up.** A `PHANTOM_SPEND` on Railway is not revoked. It
still closes the deep-dive gate (`billingStatus = phantom`) and logs an error;
revocation stays a laptop action (`pnpm orbio:auth`, then the managed loop).
Key management is demonstrated locally, not in production.

**Net effect on the claim.** Production can show balance-derived metabolism for
about an hour after each push, and the panel must say that window exists — the
same bound recorded under M9 follow-up, now reachable instead of 100% null.

## Commit loop, corrected the same day: null RPC answers were being cached (2026-09-15, later)

The fix above made things worse. Root cause of the receipt timeouts, found only
after Codex's Phase A review showed 0/200 recent launches committed: the
`rpc-budget` response cache treats every hash-addressed read as immutable and
was caching `null` — the first receipt poll that hit a lagging node behind
Chainstack's load balancer got "not found", and every later poll for the whole
240 s deadline was served that null from cache. Holding the batch and re-polling
for 30 minutes therefore re-polled the same cached null, so each slow receipt
stalled commits for ~34 minutes instead of ~4. Between the 05:27 and ~08:00 UTC
deploys, batches landed every ~35 minutes against ~18k reports/day, and the
200-leaf oldest-first batches never reached recent launches.

Now: a `null` result is never cached (a real answer still is, once it exists),
and a held batch no longer blocks the next one — its reports are excluded from
`pending` until it is recorded or dropped. The "resolved before any new batch is
sent" wording above is superseded.

## Commit loop — a sent tx is resolved before another is sent (2026-09-15)

The public feed posted `commit lag: 10min` at 21:18 local. Cause: four
`commitBatch` txs in the recent log hit the 240s receipt deadline; all four had
**mined successfully** (checked by hash). With no DB row written, their reports
stayed uncommitted and were re-anchored by the next batch — orphan roots
on-chain, extra gas, and proofs that point at a later commit than the one that
actually came first. Launch volume is ~3× last week (8,964/24h) and outcome
resolution was logging RPC network errors at the same time, so the shared RPC
budget is the likely reason receipts are slow; that part is unconfirmed.

Now: a timed-out tx is held as *unconfirmed* and checked every tick before any
new batch goes out — late success records that batch, a revert or 30 minutes
with no receipt drops it and lets its reports re-commit. Held in memory; a
restart falls back to the old behaviour. Earlier orphan roots are left as they
are (on-chain, harmless to verification — every report still has a valid proof
under the root recorded for it).

## Checkpoint after M3 — Fable's calls on the mid-build review (2026-09-05)

Full memo: `checkpoint-decisions-m4.md`. Mid-build review: `midbuild-review-m0-m3.md`.
Both at repo root. Nothing here reopens M0–M3.

- **Data layer:** RPC + ScanHood + our own log reconstruction. No Blockscout at
  runtime (Cloudflare 403); its URLs are human-readable evidence only. M4 adds a
  `packages/rpc-budget` global token bucket + priority queue (watcher > commit >
  outcomes > deepdive > backfill) + response cache, and one `AddressHistoryProvider`
  interface (RPC-logs impl now, indexer later). Probe + use the RPC's real
  `eth_getLogs` range limit.
- **Launchpad attribution:** confirm Pons + LONG by **runtime code hash**
  (`keccak256(eth_getCode(token))`; launchpad tokens share a template), factory
  address second. $ORBIO is the Pons specimen. Blocks the backfill, not M4 code.
  `lp_locked_by_construction` = true only after on-chain custody verification of
  one real position; unverified stays `unknown` and keeps being scored for
  SELL/LIQ (conservative).
- **Freshness gate:** widen 1h → 24h token age at pool creation; store
  `token_age_at_pool_sec`. Tokenized stocks (code older than 24h at pool
  creation) are treated as the quote side; use ScanHood `rwa`.
- **`det_v0` priors:** run a 3-day partial backfill → observed base rates → set
  intercepts to `logit(base rate)`, keep hand-set weight directions → version as
  **`det_v0.1`**, commit the new weights hash. Poor coverage (>70% null) outputs
  the base rate with `confidence: low`, not the logistic's null-vector guess.
  Existing `det_v0` reports stay as posted.
- **`sell_impact_bps`:** RPC-only. Spot price from a tiny Quoter quote, then quote
  sells sized to **100 and 1,000 USDG**; store `sell_impact_bps_100` /
  `sell_impact_bps_1000`. ScanHood `priceUsd` is corroboration only.
- **Cluster rule 4:** ship disabled; keep the `FirstInboundLookup` interface.
- **Backfill scope:** 14 days, not 45. Print a call-count estimate before running;
  enforce `--max-calls`.
- **RevenueSplitter contract:** deferred / not built. The 2% → ZachXBT is a
  periodic **manual transfer** from `REVENUE_ADDRESS`, logged publicly
  (spec §0.1 — minimise money-handling surface). Supersedes the section below.

Rewritten M4 build prompt and M6 tool list are in `checkpoint-decisions-m4.md`
§C / §D. Order of operations: (1) Cooper does Pons+LONG attribution in a browser,
(2) M4 code + a 3-day pass, (3) choose `det_v0.1` intercepts, (4) 14-day backfill
in the background while M5 starts.

## Revenue split — 2% of gross to ZachXBT, in perpetuity (2026-09-05)

> **Superseded 2026-09-05 by the checkpoint above:** no splitter contract. The
> 2% is a periodic manual transfer from `REVENUE_ADDRESS`, logged publicly. The
> percentage, recipient and rationale below still stand.

A fixed **2.00% (200 bps)** of gross USDG revenue routes to
**`0x6eA158145907a1fAc74016087611913A96d96624`** (ZachXBT's public donation
address, for now) as a no-strings thank-you. The rest goes to the operator's
plain `REVENUE_ADDRESS`.

**Mechanism (build in M7):** a small `RevenueSplitter` contract on chain 4663 is
the x402 payee, so every paid call splits at receipt — on-chain and publicly
verifiable, no keeper, no discretion. Prefer a pull pattern (`release(token)`)
or immediate forward; USDG only. Not a treasury router — no token buys, no
schedule (those were cut in spec §11). The split % and recipient are contract
constructor args / immutables; changing them = deploy a new splitter and
re-point `REVENUE_ADDRESS` / the x402 payee.

Config: `.env` `REVENUE_SPLITTER_ADDRESS`, `SPLIT_ZACHXBT_BPS`,
`SPLIT_ZACHXBT_ADDRESS`.

Rationale: the v0.4 Trace layer (spec §10.1) is modelled on ZachXBT's fund-tracing
work; this is an explicit, transparent acknowledgement rather than just a credit
line. He is not involved in or endorsing the project.

---

## Final-stretch autonomy rule (2026-09-12, Fable)

**Standing until submission.** The main drag on the last 48 hours is round-trips:
stopping to ask about things that are reversible anyway.

**Decide alone and record the choice** — anything versioned and reversible:
model slugs, thresholds, notional sizes, window lengths, tolerances, copy and
wording, which cells are excluded, retry and timeout values. Write what was
chosen and why into `CHANGELOG.md` or here; do not open a question for it.

**Ask** — and only these:
- credentials (never create Orbio keys by hand; see below)
- money: anything that spends, transfers or commits funds
- on-chain irreversibles: a tx that cannot be undone or re-posted
- anything that changes **what the project claims** — outcome definitions, the
  wording of a public claim, what counts as a track record

**Batch questions into one message per session**, not one per step.

### Corollary: stop minting Orbio keys manually
`orbio_create_key` mints *and retires* in the same call, so a hand-made key
silently kills whichever key the agent is currently using. The agent provisions
its own key on start; leave it alone. `ORBIO_API_KEY` in `.env` is a fallback
seed only and goes stale the moment the agent mints.

---

## M5c — billing basis, epoch reconciliation, and what actually revokes (2026-09-12)

**The near-failure.** Five live deep-dives, five validator-passed reports, zero
ledger rows: the Orbio gateway 404s OpenRouter's `GET /generation` and returns
OpenAI-shaped usage with no cost field. The IDS reconciler compared an empty
ledger with the provider's growing spend and would have revoked the agent's own
key at the $0.01 default tolerance — during the overnight unattended run.

**The design error** (external review, adopted in full): one `spend` number was
doing three jobs. They are now three things:

| job | source | field |
|---|---|---|
| what Orbio actually charged | `orbio_get_balance.spent.usd`, polled every tick | `MetabolismEpoch.providerDeltaUsd` |
| which report caused it | tokens × pinned price, then reconciled per epoch | `MetabolismSpend.costUsd` + `costBasis` |
| is the agent safe to run | three independent controls, below | `LifecycleLog.billingStatus` |

**No cost figure exists without its provenance.** `costBasis` ∈
`provider_reported | provider_generation | token_estimate | provider_reconciled_estimate | unavailable`.
An unpriced model or missing token counts records `unavailable` with cost 0 —
never a plausible-looking number. `pricingVersion` is stored on every estimate.

**Epoch reconciliation.** Each 60s lifecycle tick is an epoch: the provider's
spend delta over the window vs the sum of local estimates recorded in it. The
ratio (`reconciliationFactor`) is applied back to those rows, which become
`provider_reconciled_estimate`. The signed discrepancy is **the agent's own
cost-forecast error**, exposed on `GET /v1/lifecycle` as `estimator` — the
metabolism is a forecaster graded against reality, under the same thesis as
everything else in the project.

**Three controls, and what each does:**
1. **Hard provider budget** — the daily cap is checked against
   `max(local estimate, Σ provider deltas today)`. Gate closes; key untouched.
2. **Estimator anomaly** — |discrepancy| > `METABOLISM_ANOMALY_PCT` (50%) for
   `METABOLISM_ANOMALY_EPOCHS` (3) consecutive windows → `billingStatus =
   anomaly` → inference paused + logged. Never revokes. A bad estimate is not a
   bad key.
3. **`PHANTOM_SPEND`** — provider spend rose while the agent made zero calls
   (above `METABOLISM_PHANTOM_TOLERANCE_USD`). This is the only condition that
   means someone else holds the key. Revoke → NO_KEY → halt until
   `pnpm orbio:auth`. Named as its own lifecycle event.

`IDS_MISMATCH` is retired from the runner (kept in `state.ts` so historical rows
replay). `METABOLISM_IDS_TOLERANCE_USD` is back at 0.01 and advisory. The $100
stopgap is gone.

**M6 acceptance criterion, rewritten.** "Cost appears in the ledger" tested an
implementation detail the gateway does not expose. The criterion is now:
*after controlled inference, authoritative provider spend increases; local
aggregate spend reconciles to the provider total within the anomaly band; and
every displayed per-report cost declares its attribution basis.*

**Why not the serialized balance-delta probe** (mutex one deep-dive at a time,
read the meter before and after): it gives exact per-request cost at 10–15
runs/day and is the wrong shape for a query-driven product at dozens-to-hundreds
of evaluations/day. Reconcile windows, not requests.

### Roadmap — designed, not built this week

- **Progressive analysis tiers.** Cheap deterministic checks → cheap model
  triage → deep dive only if "is there enough here to justify investigating?"
  (not "is this token good"). Preserves finding things before they are obvious;
  makes 15/day and 5,000/day the same architecture.
- **Deduplicated launch state.** Cache key `token_address + analysis_version +
  evidence_timestamp`. Eighty queries about one token over three hours is one
  deep dive plus cheap refreshes; a material event (creator sells, LP moves,
  volume regime change) invalidates the relevant part and re-runs. The unit of
  intelligence becomes the evolving launch, not the chat request — likely the
  largest economic win available.
- **Local velocity control.** Estimated $/min and requests/min as a fast
  circuit-breaker ahead of the provider's accounting.
- **Upstream ask to Orbio.** They hold model, tokens, cost and timing per
  request server-side. Either response headers (`x-orbio-request-id`,
  `x-orbio-cost-usd`, `x-orbio-input-tokens`, `x-orbio-output-tokens`) or an
  `orbio_get_usage(since)` MCP method would make `provider_reported` the default
  basis and retire estimation entirely.

## M9 follow-up — the staleness gate now spends, and why (2026-09-14)

**Decision.** A lapsed Orbio MCP session no longer stops inference. Previously
`billingStatus: 'stale'` closed the deep-dive gate entirely — "refusing to spend
unwatched." It now allows the run, falls back to the last known balance (or the
daily cap when none has ever been read), and reports the staleness instead.
`phantom` and `anomaly` still close the gate; those are compromise signals, not
absence of news.

**Why.** Measured 2026-09-14: a gateway key keeps billing inference normally
with an OAuth session that expired two days earlier. The session bounds *key
management* — create, revoke, read balance through the MCP — not spending. The
old policy conflated the two, and the cost was total: `llm_deepdive_v0`, the
forecaster the entire benchmark exists to grade, had never run in production at
all. The guards that actually bound spend don't need Orbio reachable: the $5
daily cap, the $0.20 per-run cap, our own per-request ledger, and a gateway that
fails safe on an empty balance.

**What this costs.** We may spend up to the daily cap against a balance figure
that is hours old, or that has never been read. Bounded and visible: the panel
prints `balance last confirmed Nh ago` (`balanceStale`) or says it has never
been read (`balanceUnknown`), and the spend figures carry a `basis`
(`epoch_reconciled` | `local_ledger` | `none`) so a local estimate is never
presented as a provider-confirmed number.

**Not derivable from a flag.** This is a deliberate loosening of an M5c safety
rule, not an implementation detail — recorded here so it is read as a decision
rather than inferred from a field on the dashboard.

**Consequence for spec §0.1 property 2.** Balance reads still require the
session: probed exhaustively on 2026-09-14, the Orbio gateway exposes no key,
usage, credits, balance or account endpoint (every path returns the same HTML
catch-all; `/api/v1/models` returns real JSON, so GETs work — those routes
simply don't exist). `/api/key` returns 405 rather than 404, i.e. the route
exists but rejects GET — almost certainly the POST behind `orbio_create_key`,
deliberately not probed because that call mints *and retires* the active key.
So credit accrual can only be derived while a session is up, and property 2 is
demonstrable during the session window rather than continuously. The panel must
say which.
