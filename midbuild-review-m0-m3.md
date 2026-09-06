# Launch Auditor — mid-build review (M0–M3 done, M4–M10 remaining)

Date: 2026-09-05. Repo: `claude-stuff/launch-auditor` (private), branch `main`,
22 commits. `pnpm verify` green: 69 worker + 18 scoring tests (vitest) + 9 contract
tests (forge). ~3,900 lines of TS + a 167-line Solidity contract. 5 DB migrations.
CommitRegistry deployed and posting on-chain.

Purpose of this doc: a "measure twice" checkpoint before M4–M10. It lists what
was built, what the chain/ecosystem actually turned out to be, every bug the live
system surfaced, every place the implementation diverges from the spec/guide, the
debt carried forward, and the open decisions that should be settled now so we
don't rework the back half.

---

## 1. Milestone status

| Milestone | State | Notes |
|---|---|---|
| M0 scaffold + Prisma schema + `pnpm verify` | ✅ | monorepo, 7 build-guide tables from spec §1/§3.3/§6 |
| M0.1 trigger-aware schema | ✅ | spec §1.1: reports carry `reportTime` + `trigger`; outcomes anchor to `anchorTime` |
| M0.2 first migration + env wiring | ✅ | Postgres + Redis up via docker-compose |
| M1 watcher + index lane | ✅ | + 6 follow-up fixes (see §4) |
| M2 creator cluster + features 3/4/5/9 | ✅ | rules 1–3 live; rule 4 stubbed (see §5) |
| M3a det_v0 + heuristic_v1 | ✅ | hand-set priors, frozen |
| M3b report assembly + EIP-712 + §8.3 validator | ✅ | live-signed reports, validator-gated |
| M3c CommitRegistry deployed | ✅ | `0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe` on 4663 |
| M3d Merkle commit job | ✅ | first batch + 3 artifact commits posted on-chain |
| M4 outcome resolution + scorer + 45-day backfill | ⬜ | next |
| M5 Metabolism (Orbio MCP key lifecycle) | ⬜ | needs `claude mcp add orbio` + Build Week key |
| M6a generate `evm-token-due-diligence` skill | ⬜ | user pastes the skill prompt on the day |
| M6 LLM deep-dive `llm_deepdive_v0` | ⬜ | needs Metabolism + a pinned model slug |
| M7 API + MCP server + fork-and-run (payments if time) | ⬜ | revenue-splitter (2% → ZachXBT) lands here |
| M8 dashboard (Metabolism panel first) + Telegram | ⬜ | |
| M9 deploy (Railway) | ⬜ | |
| M10 demo + submission | ⬜ | |

**On-chain so far (chain 4663):**
- CommitRegistry `0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe`, owner = gas wallet `0x9b4EDe199198ca3D41A9a7D2997606BaCd30BA03`
- deploy tx `0x0c86fa95…964d9199` (block 55362197)
- batch 0: root `0x56773f24…c68c5add`, 2 leaves, tx `0xa7d95190…8ea4c8ff` (block 55365811)
- 3 artifact-hash commits (weights / feature-code manifest / outcome-rule text)
- gas wallet ~0.0498 ETH left (all M3 on-chain activity cost ~0.00015 ETH)
- agent signing identity: `0x6a5A2d5Ad4c4De33f851f971fa14923f5095B4BE`

**DB right now:** 358 launches, 2 reports (both committed), 4 commits.

---

## 2. What was built (substance, not just "did X")

**Watcher (M1).** A source-agnostic net: poll Uniswap **v2 `PairCreated` / v3
`PoolCreated` / v4 `Initialize`** on the canonical 4663 deployments every 2s, one
range-limited `eth_getLogs` per window, persisted cursor. v4 is where essentially
every launch lands. Each new pool → classify token vs quote → attribute a
launchpad (or `raw`) → write `launches` + `features` rows with provenance →
per-creator quota flag → enqueue a T+10m job. Index-lane features now:
`source`/`lp_locked`, `creator_devbuy_pct` (recipient-based per spec §8.2 Pons
note). `pnpm watcher:replay` / `watcher:recent` / `watcher:prune-stale`.

**Launchpad registry.** Config-driven (`config/chain.4663.json`), 8 pads:
pons, long, hookr, v4fun, noxa, sentry, virtuals, poolstrade. **Zero confirmed
factory addresses** → everything currently attributes to `source: "raw"`. The
universal pool net catches the tokens regardless; per-pad confirmation means
tracing one real launch tx per pad on Blockscout (a manual, browser-side step).

**Creator cluster §3.2 (M2).** `creator_cluster` table, one row per (wallet,
rule) with an evidence tx and a per-rule confidence. Rules 1 (creator), 2 (bought
in the launch block), 3 (direct transfer from creator) are live and RPC-only.
Rule 4 (first-ever inbound from creator) is a pluggable `FirstInboundLookup` that
ships as a **no-op** — see §5.

**Features 3/4/5/9 (M2).** `creator_age_days` (capped nonce binary search),
`creator_prior_*` (own DB), `cluster_size`/`cluster_supply_pct`/`top10_noncreator_pct`
(balances rebuilt from `Transfer` logs at T+10m), and feature 9 for
non-launchpad launches on the qualified lane: **GoPlus** (`token_security/4663`,
no key) + **ScanHood** (`scanhood.xyz/api/scan` + `/api/quote`) cross-checked →
`verified`/`owner_renounced`/`mintable`/`lp_holder_type`/`sell_sim_ok`/`sell_tax_bps`,
raw payloads stored, plus our **own** `eth_call` to the v4 Quoter for
`sell_impact_bps` and ScanHood's `market.liq` for `liquidity_usd_10m`.

**Forecasters (M3a).** `det_v0` — one logistic per outcome/horizon over a
standardized feature vector, weights frozen in `weights/det_v0.json`.
`heuristic_v1` — the spec §2 fixed rule as a single manipulation flag applied to
every applicable outcome cell. `ALL_OUTCOME_KEYS` + `outcomeApplies` (SELL/LIQ
impaired are N/A for launchpad-locked tokens).

**Reports + signing + validator (M3b).** For each launch, at T+10m: build the
feature inputs + a `coverage` list of null features, pin the T+10m block
(`number`/`hash`/UTC `timestamp`), run both forecasters → RFC 8785 canonical JSON
→ keccak256 → EIP-712 sign a compact `ReportCommitment` struct with
`AGENT_EIP712_PRIVATE_KEY` → run the **§8.3 validator** (chain/address match,
real block pin, probabilities in range, hash integrity, signer == identity,
"no unknown-as-pass") → persist to `reports` with `validatorPassed`. Only passing
reports are commit-eligible; failures are stored with reasons and never committed.

**Commit chain (M3c/d).** `CommitRegistry.sol` — owner-gated, event-only, holds
no funds: `commitBatch(root, leafCount)` → `BatchCommitted`,
`commitArtifact(kind, hash)` → `ArtifactCommitted`, `rotateOwner`. The worker's
`runCommitLoop` batches validated+uncommitted report hashes (every
`commitMaxLeaves` / `commitIntervalSec`, `--force` overrides), builds a
sorted-pair keccak256 Merkle tree, posts the root, stores per-leaf proofs in
`Commit.leaves`, links `Report.commitId`. A one-time run commits the hashes of
`weights/det_v0.json`, a 14-file feature-code manifest, and `OUTCOME_RULES_v1.md`.
`pnpm commit:verify <reportHash>` verifies the stored proof against the batch root
AND confirms that root is in an on-chain `BatchCommitted` event — exactly what
M7's `GET /v1/proof/<hash>` will do.

---

## 3. What Robinhood Chain / the ecosystem actually turned out to be

The spec was written before any of this was verified on-chain. Findings:

1. **Chain 4663** — Arbitrum Orbit L2, public mainnet 1 Jul 2026, **~10 blocks/sec
   (~100ms)**, gas in ETH, no native chain token. At ~54M blocks.
2. **Launchpad market is large and churny.** Pons is dominant (~64% of tracked
   launchpad fees). Others: LONG/long.xyz (pairs new tokens against Robinhood
   tokenized *stocks* — NVDA, HIMS…), Hookr.fun (v4 hooks), v4.fun (Canopy/$CNPY),
   Bags, Flap, hood.fun, Pools.trade (Uniswap Labs), Sentry, Virtuals, Robinfun.
   Noxa is deprecated. **Almost everything is Uniswap v4.** v3 sees ~no volume;
   v2 has a trickle (possibly LONG's stock pairs).
3. **Blockscout is behind Cloudflare and returns 403 to any server-side fetch.**
   Only a real browser passes. This breaks the spec/guide assumption that the
   index lane can use "RPC + Blockscout" — the worker cannot call Blockscout at
   runtime. Everything moved to RPC-only or an alternative source. **This is the
   single biggest structural deviation and it also affects M4 and M6** (see §7).
4. **ordofi RPC** (`rpc.ordofi.network`): no auth for reads, 600 req/min per IP,
   `eth_getLogs` range limit ~10–20k blocks (we chunk at 2000). Full historical
   state works, BUT **archive reads (`eth_getCode` at old blocks,
   `eth_getTransactionCount`) take 1–6 seconds each.** That forced
   `creator_age_days` off the synchronous ingest path.
5. **publicnode's free RPC blocks all archive queries** ("Archive requests require
   a personal token") — even `eth_getLogs` on recent blocks. ordofi is the better
   choice despite its rate limit.
6. **GoPlus** supports chain 4663 (confirmed in `supported_chains`), works with no
   key, but data is thin for tokens < a few hours old.
7. **ScanHood** (`scanhood.xyz`) is purpose-built for 4663, plain-fetch-friendly
   (NOT Cloudflare-gated), and returns a genuinely useful bundle: `verdict`,
   `sellable`, `lp`, `verified`, `rwa` (tokenized-stock impostor flag),
   `deployer` reputation + launch count, `market.liq`/`priceUsd`, and a real v4
   sell quote via `/api/quote`. It became our primary external scanner.
8. **Verified 4663 addresses** (in `config/chain.4663.json`, each with evidence):
   Uniswap v4 PoolManager `0x8366a39C…40951`, v4 Quoter `0x8Dc178eF…98F94`,
   v2 factory `0x8bcEaA40…937f`, USDG `0x5fc5360D…1d168`. v3 factory + WETH:
   candidates only. **No launchpad factory confirmed.**

---

## 4. Bugs the live system surfaced (and how they were fixed)

These are where the plan met reality. All were caught by *running* the thing, not
by review.

1. **RPC-lag wedge (M1, `9c3aa4f`).** Head lag was 2 blocks on a 100ms-block,
   load-balanced RPC. A pool seen via `eth_getLogs` from one node was often not
   yet visible to the node serving the follow-up `getTransaction`/`getBlock`;
   that exception aborted the whole poll *before the cursor saved*, so the poller
   retried the identical window forever. Fixed: head lag 60, per-pool try/catch,
   retry-with-backoff on the reads, and a stuck-poll escape hatch that abandons +
   logs a `watcher:replay` hint after 6 no-progress polls.
2. **"new pool" ≠ "new token launch" (M1, `5387104`).** Found by a manual
   Blockscout spot-check (the guide's own M1 check). A fresh Uniswap v4 pool
   between two *already-established* tokens — a tokenized stock (DDOG) and USDG —
   was recorded as a launch, with the LP provider mislabeled as the creator.
   Added a freshness gate.
3. **The freshness fix silently didn't work (M1, `bd8e712`).** The first version
   called Blockscout → 403 → caught → **defaulted to "assume fresh" on every
   call** (0 of 551 flagged). Unit tests passed because they mocked the client.
   Rewrote around `eth_getCode` at `poolBlock − ~1h`. Re-check then found **35%
   of accumulated launches (196 of 554) were not new-token launches** — pruned
   via `watcher:prune-stale`.
4. **`.env` was never actually loaded (M2).** Every script read `process.env`
   directly; it only worked because the user's terminal happened to have the vars
   present some other way. A genuinely fresh shell (or CI, or Railway with real
   env vars and no `.env` file) would hit "RH_RPC_URL is not set". Added explicit
   `.env` loading (Node's built-in `loadEnvFile`, walking up from cwd; never
   overrides real env vars).
5. **`classifyPair` labeled USDG as the new token (M1).** `quoteAssets` list was
   empty. Fixed by populating USDG + two WETH candidates; also added native-ETH
   (`0x0`, v4's ETH sentinel) recognition.
6. **Address casing broke joins (M2, `ef6ceb6`).** `tx.from` was stored
   checksummed, so case-sensitive `creatorAddress` joins missed. Normalized every
   address column to lowercase on write; migrated 358 existing rows.
7. **`creator_age_days` nonce search stalled the poller ~80s/launch (M3).** The
   binary search is ~27 sequential `eth_getTransactionCount` calls at 1–6s each,
   and I'd put it in the synchronous ingest path. Moved it to the T+10m job,
   capped at 8 iterations (sub-day precision, conservative under-estimate),
   skipped when already known.
8. **Windows: Prisma engine DLL lock.** `pnpm dev:worker` (or any running node)
   locks `query_engine-windows.dll.node`, so `prisma generate` / `pnpm verify`
   hit EPERM. `verify.mjs` tolerates it (uses the existing client, warns).
9. **Config carried unverified launchpad marketing URLs (`f0e823f`, by Cooper).**
   One ("ponslaunchpad.com" as pulled from a search-result title) is a
   seed-phrase phishing clone. Every `site:` URL was stripped; a rule was added:
   confirm pads **on-chain only** (Blockscout token → creation tx → factory),
   never via marketing sites.

Non-code friction worth noting for the fork-and-run README (M7): Windows
PowerShell `&&` is a parse error; `curl` is aliased to `Invoke-WebRequest`;
running commands from the wrong directory; the Foundry installer is bash-only.

---

## 5. Deviations from spec/guide — for Fable to sanity-check

| # | Deviation | Why | Needs a call? |
|---|---|---|---|
| a | `Launch.source` is an **open string**, not the `noxa\|pons\|raw` enum; 8 pad adapters registered | User directed expanding beyond Noxa/Pons; the set churns | No — user-approved |
| b | **No launchpad factory confirmed** → every launch is `source: "raw"`, `lp_locked_by_construction` always false | Confirmation is a manual browser step (Blockscout 403 from server); not blocking the pipeline | **Yes** — see §8.2 |
| c | Creator-cluster **rule 4 is a no-op stub** (`FirstInboundLookup` interface, ships disabled) | Needs per-address tx history → Blockscout only → 403 | **Yes** — see §8.5 |
| d | `heuristic_v1` emits **one probability across all outcome cells** | Spec §2 calls it "a fixed rule"; the flag isn't outcome-specific | Low |
| e | `det_v0` weights are **hand-set directional priors, uncalibrated** — currently e.g. LIQ_IMPAIRED ~0.5 on an all-null vector | Spec §4 says exactly this; `det_v1` re-fits on the backfill | **Yes** — see §8.3 |
| f | `sell_impact_bps` sells **0.1% of total supply** as the fixed size → large impact on thin pools (65% on one real test) | Deterministic + reproducible with no price oracle | **Yes** — see §8.4 |
| g | EIP-712 signs a **compact `ReportCommitment`** (reportHash + chainId + token + reportTime + forecaster), not the full report object | The canonical JSON is the content; its hash is what's signed + committed | Low — standard pattern |
| h | Only `det_v0` + `heuristic_v1` reports are emitted; **`base_rate` / `scanhood` / `goplus` not yet** | base_rate needs resolved outcomes (M4); scanhood/goplus need the §2-item-5 `[0,1]` mapping (deferred) | No — planned for M4 |
| i | `CommitRegistry` is **minimal + event-only** | Spec says "unchanged from v0.1 §9.1", which wasn't in the v0.2 doc I have | Confirm the shape is acceptable |
| j | Guide's M1 check wanted a **Noxa launch fixture**; used real Pons-style + raw launches | No Noxa factory to test against | No |
| k | §8.3 "no unknown-as-pass" is a **coverage-ratio heuristic** (>70% features null + near-floor probability → fail) | The real teeth of that check bind on the M6 LLM output | Confirm it's enough for the deterministic path |
| l | `has_x` / `has_site` (feature 8) and `microbuy_share_10m` (feature 6) are **always null** | Socials need a launchpad API (qualified lane), not RPC; microbuy needs a size threshold decision | Low |

---

## 6. Schema shape (for reference)

7 build-guide tables + `watcher_cursors` + `creator_cluster`. Key choices:
`Report`/`Outcome` anchor to `(chainId, tokenAddress, reportTime/anchorTime)` not
to a launch (spec §1.1 — reports can be issued for a token of any age). `Report`
gained `coverage`, `blockPin`, `validatorPassed`, `validatorFailures` in M3.
`Launch` gained `poolKind`/`poolId`/`poolFee`/`poolTickSpacing`/`poolHooks` (the
v4 PoolKey), `quoteAddress`, `sourceConfidence`, `detectedVia`. Merkle proofs are
JSON on `Commit.leaves`, not a separate table.

---

## 7. Debt carried into M4–M10

- **Blockscout 403 hits M4 and M6 too.** M4 outcome resolution "reads
  price/liquidity/holder data from RPC and Blockscout" (guide) — the Blockscout
  half won't work from the server. M6's deep-dive tool list includes
  `blockscout_address` / `blockscout_txs`. Both need a resolved answer (§8.1).
- Pre-M2 launch rows lack the pool-key fields and `creator_age_days` (both fill on
  a T+10m re-run; a backfill pass in M4 can force it).
- No launchpad attribution → `lp_locked_by_construction` is universally false →
  SELL_IMPAIRED / LIQ_IMPAIRED are being scored for *every* launch when they
  should be N/A for bonding-curve pads.
- The commit loop is a `setInterval` in the worker, not a BullMQ job — fine for
  one instance; each fork-and-run instance runs its own.
- `forge-std` is vendored (~1.1 MB) so `forge test` needs no network on a fresh
  clone.
- `det_v0` won't be trustworthy until fitted on the backfill (M4). The first
  weeks of live commits will be with the hand-set priors — that's by design
  (both `det_v0` and `det_v1` run live so the improvement is visible), but the
  priors should at least be *directionally* defensible before real reports pile up.

---

## 8. Open decisions for this checkpoint

Settle these now to avoid rework in M4–M7.

**8.1 Blockscout replacement strategy (affects M4 + M6).**
Options: (a) self-host a Blockscout instance for chain 4663 (real infra, but
restores the spec's assumed capability everywhere); (b) commit to "RPC + ScanHood
+ our own log reconstruction" as the standing data layer and rewrite the M4/M6
prompts accordingly; (c) find a Blockscout API key / an alternative indexer
(Bitquery has a 4663 GraphQL endpoint, free tier). Recommendation: **(b)** for the
contest — it's what already works — with (a) noted as the post-contest fix. This
needs Fable's blessing because it changes the M4 and M6 guide prompts.

**8.2 Launchpad attribution — blocker or not?**
Right now every launch is `raw`. Confirming Pons alone (trace one ponslaunchpad
token's creation tx on Blockscout via browser, add the factory to config, flip
`verified`) would light up: correct `lp_locked_by_construction`, the
`heuristic_v1` launch-block-cluster signal for the dominant pad, and per-pad
metrics in the benchmark. Recommendation: **confirm Pons + LONG before M4's
backfill runs** (so the backfilled rows are attributed), treat the other 6 as
best-effort.

**8.3 `det_v0` priors — tune or ship?**
They're explicitly placeholder, but a null-vector LIQ_IMPAIRED of ~0.5 will look
wrong on the dashboard from day one. Options: ship as-is (honest — it's a prior),
or spend ~1h making the biases produce a sane "clean launch ≈ 10–20%" baseline
before real reports accumulate. Recommendation: **quick bias pass**, keep the
weight *directions*, don't overfit — `det_v1` does the real work.

**8.4 `sell_impact_bps` sell size.**
0.1% of total supply is large for these pools. Alternatives: 0.01% of supply, or a
fixed small USDG notional (needs a price, which ScanHood provides). Recommendation:
**switch to a fixed USDG notional** (e.g. $100-equivalent) using ScanHood's
`priceUsd` — more comparable across tokens, closer to what a real seller faces.

**8.5 Cluster rule 4 — ship disabled, or add a history source now?**
Rule 4 catches "wallet the creator funded into existence." Without it the cluster
is narrower (rules 1–3 only). Adding it needs an address-history index. Options:
ship disabled for the contest (rules 1–3 are the load-bearing ones anyway), or add
a Bitquery-backed `FirstInboundLookup` (free tier, ~an hour). Recommendation:
**ship disabled**, note it as a v0.4-adjacent gap.

**8.6 Anything Fable's newer thinking changes** — the §0.1 Orbio-test framing,
§8.1 fork-and-run, §8.2/§8.3 deep-dive method + validator are all folded in.
The Pons dev-buy note is applied. If there's more, now is the cheap moment.

---

## 9. What the remaining milestones still need from the user

- **M4** — nothing new. (Blockscout decision from §8.1 shapes the approach.)
- **M5** — `claude mcp add --transport http orbio https://www.orbio.so/api/mcp`
  + browser OAuth; an Orbio Build Week key claimed from the dashboard.
- **M6a** — paste the `evm-token-due-diligence` skill prompt.
- **M6** — a pinned OpenRouter model slug (I'll put 3 priced candidates in the
  CHANGELOG to choose from) + the `openrouter` MCP connected for live price checks.
- **M7** — `REVENUE_ADDRESS` (a fresh address, no key on server); the
  RevenueSplitter (2% → ZachXBT `0x6eA1581…96d96624`, per `DECISIONS.md`) deploys
  here.
- **M8** — a Telegram bot token + channel id.
- **M9** — Railway account; Postgres + Redis add-ons.
