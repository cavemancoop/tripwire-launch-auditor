# Changelog

Append-only. Each entry: what changed, deliberate scope calls, and what the human should verify.

## M0 — Scaffold (2026-09-02)

### Added
- pnpm monorepo (ESM, TS strict, `moduleResolution: Bundler`) with a version `catalog:` in `pnpm-workspace.yaml`.
- `apps/api` — Fastify with `GET /health`; `inject()` test.
- `apps/worker` — BullMQ queue-name registry + `parseRedisUrl`; unit tests (no live Redis).
- `packages/chain` — viem chain definition for id 4663 + `getPublicClient(rpcUrl)`; typed `BlockscoutClient` (v2) with an injectable `fetch`; fixture-backed test, no live calls.
- `packages/db` — Prisma schema for the seven tables named in the build guide:
  `launches`, `features`, `reports`, `commits`, `outcomes`, `lifecycle_log`, `receipts`,
  modelled from spec §1 (outcomes + horizons), §3.3 (feature vector v0), §6 (commitment).
  Schema-text test asserts the four outcomes and the six forecasters are present.
- `packages/scoring` — forecaster/metric types + `baseRate` / `brier`; unit test.
- `docker-compose.yml` (Postgres 16 + Redis 7, healthchecks), `.env.example` (grouped by the milestone that first needs each var).
- `CLAUDE.md` (build-guide working rules verbatim), `scripts/verify.mjs`.

### Deliberate scope calls
- Merkle proof storage is a JSON column on `commits` (`leaves`), not a separate `commit_leaves` table. M3 fills it.
- `Feature` keeps typed columns for every v0 feature plus a `provenance` JSON map (feature -> {source, block, fetchedAt}) and verbatim `goplusRaw` / `scanhoodRaw` blobs with fetch timestamps, per spec §3.3.
- viem / Blockscout clients are typed skeletons only. No discovery of factory contracts or event subscriptions — that is M1.
- `prisma migrate` has **not** been run (needs Docker). `pnpm verify` uses `prisma validate` instead.

### Verify
- `pnpm install` then `pnpm verify` is green.
- After installing Docker Desktop: `docker compose up -d && pnpm db:migrate` creates the schema with no errors.
- Read `packages/db/prisma/schema.prisma` against spec §1 / §3.3 / §6 and flag any field a later milestone will need that is missing.

### Not done in M0 (later milestones)
- Watcher, feature computation, deterministic score, outcome resolution, commits, Metabolism, LLM deep-dive, payments, dashboard, deploy.

## M0.1 — schema made trigger-aware (2026-09-03)

Spec updated to add §1.1 (report time is arbitrary), the `POST /v1/assess/{token}`
row in §9, and the §10.1 Watch/Trace/Triage roadmap. Applied before any migration
had run, so nothing was retrofitted. Repo + planning-dir copies of the spec refreshed.

### Changed
- New enum `ReportTrigger` (`launch` | `qualified` | `on_demand` | `scheduled` | `event`).
- `Report` is no longer launch-shaped: it carries `chainId`, `tokenAddress`, `reportTime`,
  `trigger`; `launchId` is now **optional** (`onDelete: SetNull`). Added the §1.1 age-aware
  inputs as typed nullable columns: `ageHours`, `holderCountTrend`, `clusterBalanceDeltaPct`,
  `liquidityDeltaPct`, `ownershipChangedSinceLast`, `implementationChangedSinceLast`.
- `Outcome` anchors to `anchorTime` (= the `reportTime` horizons are measured from) + `trigger`,
  with `chainId` / `tokenAddress` and an optional `launchId`. Unique key is now
  `(chainId, tokenAddress, anchorTime, label, horizon, ruleVersion)` — one measurement window
  shared by every forecaster's report at that anchorTime; the scorer joins on it.
- Still exactly the seven build-guide tables. `POST /v1/assess` itself is an API concern (M7);
  the daily-re-score / watch-subscription table is v0.3 (§10.1), not built now.

### Deliberate scope call
- Age-aware inputs live on `Report` (mild denormalization across forecasters sharing a
  `reportTime`) rather than a new `assessments` table. If v0.3 makes assessments first-class,
  promoting those columns + the shared outcome window into `assessments` is the refactor.
- `Feature` stays 1:1 with `Launch` — it is the launch-time §3.3 vector. Age-aware feature
  snapshots at arbitrary report times are v0.3.

### Verify
- `pnpm verify` green (23 tests). `prisma migrate diff` still yields valid SQL for the 7 tables.

## M0.2 — first migration applied; env wiring (2026-09-03)

### Changed
- `db:generate` / `db:validate` / `db:migrate` / `db:studio` now run from the repo root
  (`prisma ... --schema packages/db/prisma/schema.prisma`) so Prisma loads the repo-root
  `.env`. Previously they ran inside `packages/db`, which has no `.env`, so `prisma migrate`
  failed with "Environment variable not found: DATABASE_URL". `prisma` + `@prisma/client`
  added as root devDependencies; `packages/db` keeps its own copy for the `postinstall` generate.
- `scripts/verify.mjs` uses the same root-level `prisma --schema ...` invocation.
- Single env file: repo-root `.env` (gitignored), created from `.env.example`.

### Added
- `packages/db/prisma/migrations/20260904044402_init/` — the first migration (7 tables + 8 enums).

### Verify
- `docker compose up -d` → `pnpm db:migrate` applies cleanly; all 7 tables present in Postgres.
- `pnpm verify` green. **M0 check now fully satisfied.**

## M1 — Watcher + index lane (2026-09-03)

RPC wired: `RH_RPC_URL=https://rpc.ordofi.network` (chain 4663, ~10 blocks/s,
`eth_getLogs` range ~10–20k → chunked at 2000, 600 req/min, no auth for reads).

### Added — `packages/chain`
- `uniswap.ts` — v2 `PairCreated` / v3 `PoolCreated` / v4 `Initialize` ABIs, topic0s
  computed via viem (not hardcoded), and `decodePoolCreation(log)` → `{poolKind, token0,
  token1, poolAddress|poolId, fee, tickSpacing, hooks}`. Decode verified against a real
  4663 Initialize log.
- `chain-config.ts` + committed `config/chain.4663.json` — every address carries a
  `verified` flag + Blockscout evidence link + a note. **Verified:** v4 PoolManager
  `0x8366a39C…40951` (CREATE2 deployer, ~$29M TVL); v2 factory `0x8bcEaA40…937f`
  (emits PairCreated live); USDG `0x5fc5360D…1d168`. **Candidate / unverified:** v3
  factory `0x1f7d7550…` (did emit a real PoolCreated in the smoke test), WETH ×2.
- `launchpads.ts` — config-driven adapter registry for **pons, long, hookr, v4fun,
  noxa, sentry, virtuals, poolstrade** (per your list). `attributeSource(chainId,
  touchedAddresses)` → launchpad key or `"raw"`. **No launchpad factory is confirmed
  yet** — every entry is `candidateFactories` only, so everything currently attributes
  to `raw`. The universal pool net catches those tokens regardless; per-pad
  confirmation needs a real launch tx traced on Blockscout (see each entry's `note`).
- `logs.ts` — `getLogsChunked` (range-limited `eth_getLogs`).

### Added — `apps/worker`
- Polling watcher (`watcher/poller.ts`): 2s interval, persisted cursor
  (`watcher_cursors`), reorg lag, one source-agnostic `eth_getLogs` per window across
  all Uniswap cores.
- `watcher/ingest.ts` — new pool → `classifyPair` (USDG/WETH vs new token) →
  `attributeSource` → `launches` + `features` rows with provenance → per-creator quota
  flag (spec §3.1) → enqueue the T+10m job.
- Index-lane features now: `creatorDevbuyPct` (item 2), `source`/`lpLockedByConstruction`
  (item 1). `hasX`/`hasSite` (item 8) left null — needs a launchpad API, not RPC-only.
- T+10m job (`watcher/t10.ts`, `features.ts`): `uniqueBuyers10m` + `buysPerBuyer10m`
  (item 6), `MAX_T10_LOGS` guard against a misclassified quote asset. Items 4–5
  (cluster) and 7 (liquidity USD / sell impact) are **M2**.
- `pnpm watcher:replay --from <block> [--span <blocks>]`.

### Schema (migrations `m1_watcher_launch_fields`, `m1_launch_quote_address`)
- `Launch.source` is now an open `String` (`@default("unknown")`); `enum LaunchSource`
  removed. Added `sourceConfidence`, `quoteAddress`, `poolKind`, `poolId`, `detectedVia`.
- New `watcher_cursors` table (last-processed block per chain per stream).

### Live smoke test (bounded replay, then wiped)
- Detected v4/v3/v2 pool creations on 4663; ingested ~45 `launches` rows; index features
  on all; quota flag fired on a real repeat creator; T+10m pass produced real buyer
  counts (5–108 buyers/token). Found + fixed one bug: empty `quoteAssets` made
  `classifyPair` label USDG as the token.

### Verify
- `pnpm verify` green (50 tests).
- **Still needed for the guide's M1 check:** run `pnpm dev:worker` for ~30 min and
  confirm `SELECT count(*) FROM launches` grows with T+10m features filling in; spot-check
  one launch on Blockscout. Then trace one real launch per pad to fill in
  `config/chain.4663.json` `factories` and flip `verified`.

## M1.1 — watcher hardening from live operation (2026-09-04)

Three real bugs found by actually running the watcher and doing the guide's own
spot-check, not by review:

1. **RPC-lag wedge** (`9c3aa4f`): head lag was 2 blocks on a ~10-blocks/s,
   load-balanced RPC; a follow-up read for a just-seen pool would sometimes
   miss, and that exception aborted the whole poll before the cursor saved —
   so the poller retried the identical window forever. Fixed: head lag 60,
   retry-with-backoff on the per-pool reads, per-pool error isolation (cursor
   holds just before the earliest failure, everything else still commits),
   and a stuck-poll escape hatch that abandons + logs a replay hint after 6
   no-progress polls. `pnpm verify` also no longer fails when `dev:worker` has
   the Prisma engine file locked.
2. **Command-argument gap**: `watcher:recent` only took a row count; added
   `<from>-<to>` block-range and `--from`/`--to` forms so a range copied
   straight from a `[watcher]` log line works.
3. **Spec-correctness bug** (`5387104`): a fresh Uniswap pool between two
   already-established tokens (found via a DDOG/USDG spot-check) was being
   recorded as a new-token launch. Added `checkTokenFreshness` — Blockscout's
   indexed contract-creation tx tells us whether the token predates the pool
   by more than ~1h; if so, skip it. `pnpm watcher:prune-stale [--apply]`
   re-checks already-indexed launches and removes the false positives.

Config also had unverified launchpad **marketing-site URLs stripped** after one
turned out to be a phishing clone (Cooper, `f0e823f`) — launchpad factory
confirmation is on-chain only (Blockscout token → creation tx → factory) from here.

### Verify
- `pnpm verify` green (63 tests).
- Ran `pnpm watcher:prune-stale` (dry run) against the live data accumulated before
  this fix — see the session for the count of pre-existing-token false positives found.

## M2 Part A — creator cluster + features 3, 4, 5 (2026-09-05)

RPC-only. Blockscout (the spec-intended source for address history / holder lists)
is 403 from the server, so everything here is reconstructed from RPC.

### Added — `apps/worker`
- `cluster.ts` — creator cluster v1 (spec §3.2). Rules **1** (creator), **2** (bought
  in the launch block — token `Transfer` from the pool that block), **3** (received
  tokens directly from the creator, within the T+10m window). Each membership row
  carries its rule + evidence tx + a per-rule confidence; cluster confidence =
  mean of rows. **Rule 4** (first-ever inbound from creator) is a pluggable
  `FirstInboundLookup` with a no-op default — it needs an address-history index we
  don't have server-side; slots in later. Not in the guide's M2 check.
- `creator.ts` — feature 3: `creator_age_days` via `eth_getTransactionCount` binary
  search (~27 calls, RPC-only); `creator_prior_launches` / `creator_prior_insider_exit_rate`
  from our own DB (empty until backfill / resolved outcomes).
- `holders.ts` — features 4, 5: balances reconstructed from the token's `Transfer`
  logs up to the T+10m block → `cluster_supply_pct`, `top10_noncreator_pct` (excludes
  creator + pool). `MAX_HOLDER_LOGS` guard; percentages computed in bigint to 12dp
  (token supplies exceed 2^53).
- `erc20.ts` — shared `Transfer` topic0 + address/topic/value helpers (dedup'd out of
  `features.ts`).
- Wired into the T+10m job (`t10.ts`): buyers → cluster → holder stats → feature 3
  refresh, written with the `creator_cluster` rows in one transaction.

### Schema (`m2_cluster_and_pool_key`)
- New `creator_cluster` table + `ClusterRule` enum; `clusterConfidence` on `Feature`.
- `poolFee` / `poolTickSpacing` / `poolHooks` on `Launch` (the full v4 PoolKey — Part B's
  own sell-quote `eth_call` needs it).
- All address columns normalised to lowercase on write; 358 existing rows migrated.
  (`tx.from` was stored checksummed, which broke case-sensitive `creatorAddress` joins.)

### Verify
- `pnpm verify` green (38 worker tests + others). Live-tested `runT10ForLaunch` against
  real launches: clusters built with evidence txs, `top10_noncreator_pct` in the 5–13%
  range on active launches, `cluster_supply_pct` non-zero where the creator holds.
- Known: `creator_age_days` is null on launches ingested before this milestone (feature 3
  was ingest-only in M1); refreshed on any T+10m re-run. Perf: the holder-balance
  reconstruction fetches every `Transfer` in the window — 500+ buyer launches take a few
  seconds; watch at scale.

## M2 Part B — feature 9 + quote-based sell impact (2026-09-05)

### Added — `apps/worker`
- `scanners/goplus.ts` — GoPlus `token_security/4663` client (confirmed in their
  supported_chains; no key needed, key raises limits). `mapGoPlus` → verified /
  mintable / honeypot / owner-renounced / sell-tax-bps / lp-locked. Data is often
  thin for very fresh tokens — every field optional.
- `scanners/scanhood.ts` — ScanHood `/api/scan` + `/api/quote` (purpose-built for
  4663, reachable from a plain server fetch, ~5 req/s). `mapScanHood` → verified /
  sellable / lp type / `market.liq` (feeds `liquidity_usd_10m`) / deployer launch
  count / RWA-impostor flag.
- `watcher/sellimpact.ts` — our **own** `eth_call` to the v4 Quoter
  (`0x8Dc178eF…98F94`, verified live) with a fixed-size sell (0.1% of total supply)
  vs a near-spot quote → `sell_impact_bps`. v4 only (v3 barely used on 4663). A
  quoter revert ⇒ `sell_sim_ok = false`.
- `watcher/feature9.ts` — runs both scanners + our quote in parallel, cross-checks
  overlapping fields, stores raw payloads + fetch timestamps in `goplusRaw` /
  `scanhoodRaw`. Fires on the T+10m job for **non-launchpad** launches that
  qualify (`unique_buyers_10m ≥ 25`, spec §3.1/§12); sets `lane = qualified`.

### Config / env
- `v4Quoter` added to `config/chain.4663.json`.
- `getPublicClient` now takes `timeout` (30s default) + `retryCount` (5) — ordofi's
  historical reads run 1–6s under load.
- `QUALIFY_UNIQUE_BUYERS` (25), `SCANHOOD_API_BASE`, optional `GOPLUS_API_KEY`.

### Resilience / perf fixes found while wiring
- `creator_age_days` nonce binary search is 1–6s **per RPC call** on ordofi's
  archive path. Moved it off the synchronous ingest path entirely (it was stalling
  the poller ~80s/launch); it now runs only on the T+10m job, capped at 8
  iterations (sub-day precision), skipped when already known, and returns a
  conservative under-estimate.
- `buildCreatorCluster` catches a transient RPC failure per rule and reports
  `partial` — a failed rule no longer loses the others. `t10ComputedAt` stays null
  on a partial run so a re-run finishes it.

### Verify
- `pnpm verify` green (50 worker tests). Live: `computeFeature9` against a real
  token + pool key returned verified/mintable/owner-renounced from GoPlus,
  `liquidity_usd_10m` from ScanHood, and a real `sell_impact_bps` from our own
  quoter `eth_call`.
- Known: pre-Part-A `launches` rows lack `poolFee`/`poolTickSpacing`/`poolHooks`, so
  their own-quote sell impact is skipped (new launches have it). The 0.1%-of-supply
  sell size produces large `sell_impact_bps` on thin pools — deterministic and
  documented; tune the fraction against resolved data later.

## M3a — det_v0 + heuristic_v1 forecasters (2026-09-05)

`packages/scoring`: `inputs.ts` (shared nullable `FeatureInputs` + hand-set
z-normalization; missing -> 0), `heuristic.ts` (spec §2 fixed rule -> one
manipulation flag per applicable outcome cell), `det.ts` + `weights/det_v0.json`
(one logistic per outcome/horizon, `p = sigmoid(bias + Σ w·z)`; weights are
frozen directional priors, NOT fitted — `det_v1` re-derives them from the
backfill and both run live). `types.ts`: `ALL_OUTCOME_KEYS` (the 9 §1 cells) +
`outcomeApplies` (SELL/LIQ impaired are N/A for launchpad-locked tokens).
18 scoring tests. `det_v0`'s hand-set priors look miscalibrated (e.g. LIQ_IMPAIRED
sits ~0.5 on a null vector) until the backfill fit — expected per §4.

## M3b — report assembly, EIP-712 signing, §8.3 validator (2026-09-05)

`apps/worker/src/report/`:
- `crypto.ts` — RFC 8785 canonical JSON (`canonicalize`) + keccak256; EIP-712
  `ReportCommitment` struct (domain `LaunchAuditor` v1, chain 4663) signed with
  `AGENT_EIP712_PRIVATE_KEY`; `recoverReportSigner`; OutcomeKey↔Prisma column map.
- `assemble.ts` — builds `FeatureInputs` + a `coverage[]` (null features) from a
  launch's Feature + cluster rows, pins the T+10m block (`number`/`hash`/UTC
  `timestamp`), runs `heuristic_v1` + `det_v0`, produces signed `ReportDraft`s.
- `validate.ts` — the **§8.3 validator**: chain/address match, real 32-byte block
  pin hash + timestamp, probabilities in range, `reportHash == keccak(canonicalJson)`,
  signer == agent identity, and a "no unknown-as-pass" check (near-floor risk
  probability while >70% of features are unknown).
- `persist.ts` — upserts `reports` rows keyed by `reportHash`; `validatorPassed` +
  `validatorFailures` stored. Only passing rows are commit-eligible (M3d).
- Wired into the T+10m job: once the feature vector is complete, both forecasters'
  reports are assembled, signed, validated and stored.

Schema (`m3_report_validator`): `Report` gains `coverage`, `blockPin`,
`validatorPassed`, `validatorFailures`. 12 report tests + a live end-to-end run:
two reports built, block-pinned, signed by `0x6a5A2d5A…95B4BE`, validator-passed,
persisted. `pnpm verify` green (62 worker tests).

## M3c — CommitRegistry deployed + M3d — Merkle commit job (2026-09-05)

### CommitRegistry (deployed)
`0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe` on chain 4663, owner = gas wallet,
deploy tx `0x0c86fa95…964d9199` (block 55362197, ~0.0001 ETH). `deployments/4663.json`
+ the forge broadcast record committed; `COMMIT_REGISTRY_ADDRESS` in `.env`.

### M3d — commit job (`apps/worker/src/commit/`)
- `merkle.ts` — binary Merkle tree over report hashes, sorted-pair keccak256
  (OZ `MerkleProof` convention), odd node promoted; `verifyProof`. Dedupes + sorts
  leaves so the root is order-independent.
- `artifacts.ts` — `computeArtifactHashes()`: keccak256 of `weights/det_v0.json`,
  a sorted manifest of the 14 feature-code files, and `OUTCOME_RULES_v1.md`
  (new — spec §1 verbatim). Kinds = keccak256("weights"|"feature_code"|"outcome_rule").
- `job.ts` — `ensureArtifactsCommitted()` (one-time, 3 `commitArtifact` txs) then
  `runCommitJob()`: batch validated + uncommitted reports (>= `commitMaxLeaves` or
  oldest >= `commitIntervalSec`, `--force` overrides), post the root via
  `commitBatch`, persist a `Commit` row with per-leaf proofs in `leaves`, link each
  `Report.commitId` + `merkleLeafHash`. `runCommitLoop` runs it every ≤60s;
  wired into `apps/worker` (enabled only when the registry + gas key are set).
- `packages/chain/src/wallet.ts` — `getWalletClient` + `COMMIT_REGISTRY_ABI`.
- `pnpm commit:run [--force]`, `pnpm commit:verify <reportHash>` (verifies the
  stored proof against the batch root *and* confirms the root is in an on-chain
  `BatchCommitted` event — what M7's `GET /v1/proof/<hash>` will do).

### Verify
- `pnpm verify` green (69 worker + 18 scoring + 9 forge tests).
- Live: first commit posted — 3 artifact txs + batch 0 (root
  `0x56773f24…c68c5add`, 2 leaves, tx `0xa7d95190…8ea4c8ff`, block 55365811).
  `batchCount()` == 1 on-chain. `commit:verify` on a batched report:
  `proofVerifiesLocally: true`, `rootCommittedOnChain: true`. **M3 check satisfied.**

## Checkpoint after M3 — mid-build review + Fable's decisions (2026-09-05)

Not a milestone; no code changed. `midbuild-review-m0-m3.md` (what was built /
learned / fixed across M0–M3) went to Fable; `checkpoint-decisions-m4.md` is the
response. Both added at repo root next to the spec. Calls recorded in
`DECISIONS.md`. They reshape M4:

- Data layer is **RPC + ScanHood + our own logs — no Blockscout at runtime**
  (Cloudflare 403; its URLs are human-readable evidence only). M4 gains
  `packages/rpc-budget` (global token bucket + priority queue + response cache +
  `eth_getLogs`-range probe) and an `AddressHistoryProvider` interface
  (RPC-logs impl now, indexer later).
- Launchpad attribution by runtime **code hash** (Pons + LONG), a ~30-min browser
  step — blocks the 14-day backfill only, not the M4 code.
- Freshness gate 1h → **24h** token age at pool creation; add `token_age_at_pool_sec`;
  tokenized stocks (code older than 24h) treated as the quote side.
- `det_v0` → **`det_v0.1`** after a 3-day base-rate pass (intercepts =
  `logit(base rate)`, hand-set weight directions kept); poor-coverage reports
  emit the base rate at `confidence: low`. Committed `det_v0` reports stay as-is.
- `sell_impact_bps` → `sell_impact_bps_100` / `sell_impact_bps_1000` (USDG
  notionals via a Quoter spot quote, RPC-only).
- Cluster rule 4 stays **disabled** (interface kept).
- Backfill **45d → 14d**, `--max-calls` enforced, call estimate printed first.
- RevenueSplitter contract **dropped** — 2% → ZachXBT becomes a periodic manual
  logged transfer from `REVENUE_ADDRESS` (spec §0.1 — minimise money-handling
  surface).

`.env.example` updated (new M4 section; `REVENUE_SPLITTER_ADDRESS` removed).
Rewritten M4 build prompt = `checkpoint-decisions-m4.md` §C; M6 tool list = §D.

## M4a — packages/rpc-budget: shared RPC budget (2026-09-06)

Everything on chain 4663 goes through one ~600 req/min RPC (ordofi), so all
callers now share one budget (checkpoint §C step 1).

- **TokenBucket** (injectable clock), **PriorityQueue** (stable, lowest-number
  first), **ResponseCache** (bounded FIFO; caches only block-pinned /
  hash-addressed reads — never a moving tag or open-ended `eth_getLogs`).
- **RequestScheduler** — one per RPC URL, process-wide. Admits in priority order
  `watcher > commit > outcomes > deepdive > backfill`, throttles on the bucket,
  caps `maxInFlight` (12), exposes `stats`.
- **budgetedHttp** — a viem transport wrapping `http()`; every
  `request({method,params})` (what every viem action calls) hits the cache then
  the scheduler. Transport retries stay inside one budget slot.
- **getBudgetedClient(url, {priority})** — drop-in for `getPublicClient`.
- **probeGetLogsRange** — largest `eth_getLogs` span the RPC accepts
  (10k→5k→2k), one transient retry per span, conservative fallback.
- `RPC_BUDGET_RPM` (500), `RPC_MAX_GETLOGS_RANGE` (0 = probe).

Wiring: `watcher/rpc.ts`, `commit/job.ts`, `commit-verify.ts` → budgeted clients
at their tier. `chain-config`: `getGetLogsMaxRange()` / `setGetLogsMaxRange()`
runtime override; `poller` + `t10` read it. Worker boot: `bootRpcBudget()` logs
the rate and probes (or pins) the span, with a 25s guard.

26 rpc-budget tests. Live smoke: budgeted client hits ordofi; a repeated
block-pinned `getCode` is served from cache.

## M4b — outcome resolution (2026-09-06)

The four mechanical outcomes (spec §1), resolved from RPC + our own logs only —
no Blockscout (checkpoint §8.1). Anchored to `reportTime` (§1.1).

**Chain primitives** (`packages/chain/uniswap-events.ts`): decoders for v4
`Swap` / `ModifyLiquidity`, v3 `Swap`, v2 `Sync` / `Swap`; `sqrtPriceX96` →
price helpers (`tokenPriceInQuote`, decimals-cancelling).

**`apps/worker/src/outcomes/`**
- `block-time.ts` — `blockAtTime()`: bounded (18-iter) binary search on block
  timestamps, memoised per rounded second.
- `series.ts` — `buildPriceSeries` (v4/v3 Swap `sqrtPriceX96`, v2 `Sync`
  reserves) and `buildLiquiditySeries` (v4 cumulative `ModifyLiquidity`, v2
  quote-side reserve). Both return a `coverage` record (blocks, chunk size, call
  count, gaps) and back off on ordofi's transient "network is busy".
- `quote.ts` — v4 Quoter `quoteExactInputSingle` with a failure taxonomy:
  `revert` (real signal) vs `archive` / `network` (→ unresolvable).
- `resolve-drawdown.ts` — DRAWDOWN_80: max price in the reference window (first
  24h after the anchor, or the 24h before it for non-launch triggers) vs the
  horizon price (last swap in a bounded tail, else a Quoter spot call).
- `resolve-sell-impaired.ts` — SELL_IMPAIRED: 100-quote-unit sell sized off a
  tiny spot quote at the horizon block; revert or effective tax ≥ 30% → true;
  archive/network → UNRESOLVABLE, never false. NA for launchpad tokens.
- `resolve-liq.ts` — LIQ_IMPAIRED: current liquidity ≤ 20% of the post-launch
  peak via a removal. NA for launchpad tokens.
- `resolve-insider.ts` — INSIDER_EXIT: replay the creator cluster's aggregate
  balance from token `Transfer` logs (from/to ∈ cluster); a sell = a transfer to
  the pool; net-sold ≥ 50% of peak → true.
- `resolve.ts` — dispatcher: loads the launch (+ cluster), builds the pool key,
  resolves blocks for the anchor/horizon, `outcomeApplies` → NA, dispatches.
- `enumerate.ts` — `ensureOutcomeRows()`: one Outcome row per applicable
  (label, horizon) for a report's anchor time; idempotent on the unique key;
  NA rows for launchpad SELL/LIQ. Hooked into `report/persist.ts`.
- `loop.ts` — `sweepDueOutcomes()` / `runOutcomesLoop()`: resolve PENDING
  outcomes past their horizon; transient failures stay PENDING for a retry, the
  rest land RESOLVED / NA / UNRESOLVABLE with `evidence` + `coverage`. Wired
  into the worker; `pnpm outcomes:run [--loop] [--limit N]`.

Schema (`m4_outcome_coverage`): `Outcome.coverage Json?`.

45 new tests (chain 8, worker 24 + fixtures/logs helper): event decoders, price
math, series builders, `blockAtTime`, and every resolver (true / false /
NA / UNRESOLVABLE / archive-not-false). No live RPC in tests. `pnpm verify`
green (rpc-budget 26 / chain 27 / scoring 18 / worker 93).

Known: 24h–7d windows over a congested free RPC are slow even chunked at the
probed span; the `outcomes` loop runs at low priority in the background and the
M4d backfill enforces `--max-calls`.

## M4c — scorer package + benchmark CLI (2026-09-06)

checkpoint-decisions-m4.md §C step 3. The spec §2 benchmark: every forecaster
scored side by side per (outcome, horizon), split by trigger and by source.

packages/scoring:
- `metrics.ts` — AUROC (rank-sum + tie correction), AUPRC (average precision),
  log loss, Brier, Brier skill, ECE (deciles), precision/recall at a threshold.
- `delong.ts` — fast DeLong test (Sun & Xu 2014) for the difference between two
  correlated AUROCs + `normalCdf`. Gates spec §2's "beats a baseline only with a
  significant AUROC gap on >= 200 resolved".
- `mappings.ts` + `weights/forecaster_mappings_v0.json` — the fixed, published
  maps from ScanHood verdict/flags and GoPlus flags/tax to a probability per
  outcome cell (spec §2 item 5). SELL_IMPAIRED is pinned by sellability.
- `scorer.ts` — `scoreBenchmark(rows)`: per-cell metrics, `insufficientSample`
  (< 100), DeLong comparisons vs `base_rate` / `heuristic_v1` with
  `claimAllowed` (>= 200 and p < 0.05 and gain > 0); "all" section + one per
  trigger + one per source.
- `det.ts` — `det_v0.1` scaffold: `detV0_1()` / `mergeDetV01()` / `logit()` +
  `weights/det_v0_1.json` (empty `biasOverride` — set from the M4 3-day pass,
  checkpoint §8.3). Identical to det_v0 until then, scored as its own forecaster.

apps/worker/src/scorer/:
- `collect.ts` — joins RESOLVED outcomes with each forecaster's prediction for
  the same (token, anchor time): report-backed forecasters (det_v0,
  heuristic_v1, …) + computed `base_rate` (trailing-30-day prevalence) +
  `scanhood` / `goplus` from the fixed maps.
- `benchmark.ts` — `runScorer()` / `summariseBenchmark()`.
- `pnpm scorer:run [--out f.json] [--thresholds …] [--scope live|retrospective|both]`.

`commit/artifacts.ts` — two more hashes computed for commitment (spec §6):
`forecaster_mappings` (the maps JSON) and `scorer_code` (a 6-file manifest).
On-chain emission of these two is wired in M4d alongside the det_v0.1 re-commit.

25 new tests (scoring 45 total). `pnpm verify` green (rpc-budget 26 / chain 27 /
scoring 45 / worker 93). `scorer:run` verified against the live DB (0 resolved
outcomes yet — emits a valid empty benchmark).

## M4d — sell-size, 24h freshness, backfill orchestrator (2026-09-06)

checkpoint-decisions-m4.md §C steps 4–5.

### sell_impact_bps -> fixed quote-unit notionals (checkpoint §8.4)
- `sellimpact.ts` `quoteSellImpact` now sizes the sell to **100 and 1,000
  quote-asset units** (100 / 1,000 USDG for USDG pools), sized off a tiny spot
  quote — comparable across tokens, RPC-only. Returns per-notional impact bps.
- `Feature` gains `sellImpactBps100` / `sellImpactBps1000`; `sellImpactBps` stays
  as an alias for the 1,000 ("holder-sized") value so the frozen det_v0 weights
  keep working.
- `feature9.ts` / `t10.ts` wired; `t10` resolves the quote asset's decimals
  (cached) for the notional.

### 24h freshness gate + token_age_at_pool_sec (checkpoint §8.6)
- `freshness.ts` window 1h -> **24h** (`FRESH_LAUNCH_WINDOW_BLOCKS` 864,000).
- New `computeTokenAgeAtPool()` — bounded (12-iter) binary search for the
  deployment block; runs on the T+10m job / backfill, never the poller (archive
  `getCode` is 1–6s/call). `Launch.tokenAgeAtPoolSec` (migration
  `m4d_backfill_fields`).
- `ingest.ts` now uses freshness to **disambiguate** the token vs quote side when
  no configured quote asset matched — stops a months-old tokenized stock (LONG's
  pair asset) being picked as "the token" and the whole pool wrongly rejected.

### backfill orchestrator
- `apps/worker/src/backfill/run.ts` `runBackfill({ days, maxCalls, ... })`:
  probe the getLogs span, print an RPC-call estimate, then (1) discover +
  `ingestPool` every v2/v3/v4 pool in the window with `retrospective: true`,
  (2) `runT10ForLaunch` for frozen-code features, (3) `sweepDueOutcomes` with
  `qualifiedOnly` (DRAWDOWN_80 for all; cluster / INSIDER / SELL / LIQ for the
  qualified lane only). Every stage checks `budgetStats().started` against
  `--max-calls` and stops cleanly. `--dry-run` / `--resolve-only` /
  `--features-only` / `--from-block` / `--to-block` / `--all-heavy`.
- `observedBaseRates()` + `pnpm backfill` prints base rate per (label, horizon)
  and the suggested `det_v0.1` `biasOverride` = `logit(rate)` (checkpoint §8.3).
- `sweepDueOutcomes` gains the `qualifiedOnly` filter; `ingestPool` gains
  `retrospective`.

Tests: sellimpact rewritten (4), freshness +3 (`computeTokenAgeAtPool`), feature9
adjusted. `pnpm verify` green.

Still M4d: run the 3-day pass, pick det_v0.1 intercepts (or accept observed), then
commit det_v0.1 + the M4c `forecaster_mappings` / `scorer_code` artifact hashes
on-chain (extend `ensureArtifactsCommitted`).

## M4d probe fix + M5a groundwork (2026-09-06)

### probe fix
`probeGetLogsRange` now takes an optional `topics` filter; the worker boot and
the backfill pass it the v4 `Initialize` topic0 so the probe response stays
small (an unfiltered `eth_getLogs` on the busy PoolManager over 10k blocks
hangs ordofi). The backfill probe is also `Promise.race`-guarded (25s) and
falls back to the config default.

### M5a — Metabolism core (state machine + budget + crypto), no MCP
Buildable / testable without the Orbio MCP or a live key; the MCP transport
(claim / status / rotate / revoke) is M5b, gated on `claude mcp add orbio`.

- `metabolism/state.ts` — `nextState(state, event)` pure reducer for the spec §8
  machine (NO_KEY → ACTIVE → DRAINING → ROTATING; any keyed → REVOKING → NO_KEY;
  → STARVED on no credits). `manualReason()` / `isManualReason()`.
- `metabolism/budget.ts` — `dailyDeepdiveBudget()` = min(daily cap, ½ trailing
  24h credits, key remaining − reserve) with the binding constraint;
  `runsAffordable()`, `daysUnattended()`.
- `metabolism/token-store.ts` — AES-256-GCM for the Orbio OAuth token at rest
  (`TOKEN_ENCRYPTION_KEY`, 32-byte base64); `keyHashPrefix()`,
  `generateEncryptionKey()`.
- `metabolism/lifecycle.ts` — `buildLifecycleEntry()` hash-chained (each
  `bodyHash` folds the previous), `signLifecycleEntry()` (agent key),
  `verifyLifecycleChain()`, `daysSinceLastManualAction()`.
- 17 tests.

### Blocked: the 3-day backfill pass
ordofi's `eth_getLogs` is returning `-32005 "network is busy"` (or timing out at
25s) for even a small topic-filtered 1–2k-block query, while `eth_getBlock*` is
fast. publicnode rejects every `eth_getLogs` as an archive request without a paid
token. So `pnpm backfill --days 3` can't run until ordofi's log endpoint
recovers. Re-run `pnpm backfill --days 3 --max-calls 80000` then; it prints the
observed base rates + suggested det_v0.1 `biasOverride` (= logit(rate)).

## M4e — TRADING_ALIVE outcome + v4 hook / side-pool / approval feature family (2026-09-06)

From Fable's post-research-report input: the market collapsed discovery, social
proof and execution into one minute, so the product is the *precommitted,
scored pre-trade packet* — and two gaps the incumbents leave get folded into M4
before the feature freeze.

### 5th outcome — `TRADING_ALIVE` (positive polarity)
The research finding is that ~69% of launches stop trading the day they launch.
`TRADING_ALIVE@24h` / `@7d`: true when the primary pool had a trade in the 6h
ending at the horizon. It's the one outcome where `value = true` is *good* and
the published probability is `P(still trading)` — `outcomeIsPositive()` marks it;
`heuristic_v1` and the scanner maps invert for it.
- schema: `OutcomeLabel.TRADING_ALIVE`, `Report.pTradingAlive24h/_7d`
  (migration `m4e_hook_survival`); `ALL_OUTCOME_KEYS` 9 → 11 cells.
- `outcomes/resolve-survival.ts` — bounded Swap-log scan of the 6h window; an RPC
  failure is UNRESOLVABLE, never "dead".
- `det_v0.json` gains two TRADING_ALIVE blocks (survival features positive).
- `OUTCOME_RULES_v1.md` updated — its committed hash changes (re-commit with M4c's
  pending artifact re-commit).

### v4 hook / side-pool / approval surface (spec §3.3 item 10)
- `packages/chain/src/v4-hooks.ts` — `decodeHookPermissions(address)`: v4 encodes
  hook permissions in the low 14 bits of the hook address, so `hook_can_block_swap`
  / `hook_can_tax_swap` / `hook_gates_lp_removal` are computable with **zero RPC**.
- `apps/worker/src/watcher/hooks.ts` — `computeHookFeatures` (pure, index lane);
  `computeSidePoolCount` (other v4 pools the token has a currency slot in) and
  `computeCreatorDrainerApprovals` (non-infra spenders the creator/cluster
  approved) on the T+10m job. `infraAddresses(chainId)` from config.
- `Feature` gains `hookPermissions`, `hookCanBlockSwap`, `hookCanTaxSwap`,
  `hookGatesLpRemoval`, `sidePoolCount`, `creatorApprovalsOutsideRouters`.
- `inputs.ts` / `det_v0.json` weighted onto SELL_IMPAIRED, LIQ_IMPAIRED,
  DRAWDOWN_80, INSIDER_EXIT, TRADING_ALIVE. `commit/artifacts.ts` manifest
  extended (feature-code hash changes).

Roadmap from the same input (NOT built): score the callers (caller scorecard),
follower replicability for leader wallets, pre-positioning detection,
organic-volume confidence, creator credentials, an outcome oracle. Caller
scorecard + follower replicability move up if a social-trading platform / terminal
integrates — they need the wallet-behavior index, which the ~14k-launches/day
scale makes its own design problem (index qualified-launch wallets, not a census).

Spec §1 + §3.3 updated (repo + planning copies). ~24 new tests. `pnpm verify`
green (worker 23 files).

## Session 2026-09-09 — det_v0.2 backfill + M5b Orbio discovery (no code yet)

Paused mid-M5b at the user's request; working tree unchanged. This entry is the
handoff state — pick up from "Open / next" below.

### det_v0.2 backfill — RAN TO COMPLETION
`pnpm backfill --resolve-only --refeature --exclude-label INSIDER_EXIT --spread --lane-qualified --max-calls 150000`

- **75,409 RPC calls** (cap 150k not reached; `stoppedEarly:false` — exhausted the
  qualified-lane non-INSIDER work). `--refeature` rebuilt all 1,250 retrospective
  launches (53.7k calls); resolution +225 RESOLVED / ~76 UNRESOLVABLE.
- **RU estimate ~0.75–2.25M** (handoff weighting ~10–30M RU per 1M calls). No burn
  concern. Exact figure is in the Chainstack console, not readable from here.
- Log: session scratchpad `bf-detv02-20260909-124131.log`.

**New qualified-lane base rates (NOT applied to `det_v0_1.json` — user open item #4,
needs accept-vs-hand-tune + an on-chain artifact re-commit):**

| cell | n | rate | suggested biasOverride | note |
|---|---|---|---|---|
| `SELL_IMPAIRED@1h`  | 53 | 0.962 | +3.239 | newly measurable — refeature fixed the wrong-pool quotes |
| `SELL_IMPAIRED@24h` | 49 | 0.959 | +3.157 | newly measurable |
| `TRADING_ALIVE@24h` | 204 | 0.275 | -0.972 | n 79 → 204 |
| `LIQ_IMPAIRED@24h`  | 194 | 0.402 | -0.397 | n 144 → 194 |
| `DRAWDOWN_80@24h`   | 131 | 0.336 | -0.682 | n 102 → 131 |
| `INSIDER_EXIT@6h` / `@24h` | 151 / 53 | 0.119 / 0.113 | -2.000 / -2.058 | unchanged |
| `*@7d`, `INSIDER_EXIT@72h` | 0 | — | — | still nothing (excluded / not old enough) |

Caveat: `SELL_IMPAIRED` ~96% true even after refeaturing — either genuine (fixed-size
sells wreck thin fresh pools) or still artifact. User decides before it goes in.

### M5b — Orbio MCP connected; live tool set differs from spec §7.2 / §12

OAuth completed (user, browser). **The real tools are not the spec's five:**

| Spec expected | Actual | Delta |
|---|---|---|
| `orbio_get_balance` | `orbio_get_balance` `{}` | `balance.usd` = spendable quota = accrued+purchased+deposited−claimed−spent |
| `orbio_claim_key` (≤$200, drawn down) | — | gone |
| — | `orbio_create_key` `{label?:string≤60}` | mints key, **secret once**, retires existing key same call → this is claim AND rotate; **no amount, key holds nothing** |
| `orbio_get_key_status` | `orbio_get_key_status` `{}` | hasKey, prefix, createdAt, lastUsedAt, baseUrl, anthropicBaseUrl, legacy{} |
| `orbio_rotate_key` | — | gone → use `orbio_create_key` |
| `orbio_revoke_key` (unspent → balance) | `orbio_revoke_key` `{}` | balance **untouched**, no refund (key never held credit) |
| — | `orbio_delete_key` `{}` | legacy-only: disables pre-gateway OpenRouter key, returns its unspent to balance. one-way |

**Model reality:** a key holds nothing; the account balance IS the quota; every request
spends credits first then deposited $. "Drain-then-rotate the key at reserve" is
impossible as written — reinterpreted below.

**Live readings 2026-09-09:** balance `$20.33` (accrued `$206.00`, claimed `$150.68`,
gateway spent `$0`). Orbio key exists (`sk-orbio-HCfJKw`, created 19:05Z, `lastUsedAt:null`
— we do NOT hold its secret). Legacy OpenRouter key `sk-or-v1-a62…aed`: `remainingUsd $8.14`,
not disabled.

Gateway base URLs: OpenAI-shape `https://api.orbio.so/api/v1`, Anthropic-shape
`https://api.orbio.so/api`. Model ids are OpenRouter ids.

### Decisions locked this session (user)
1. **State machine (adapted spec §7.2):** NO_KEY →`create_key`→ ACTIVE; 60s poll of
   `get_balance`+`get_key_status`; keep an explicit **DRAINING** state (balance below a
   low-water mark but above hard reserve — still serving, flagged); `balance − RESERVE_USD
   ≤ 0` → STARVED (wait for hourly accrual, **no rotate** — a new key spends the same empty
   balance); key age ≥ `hygieneRotateDays` (7) → ROTATING →`create_key`→ ACTIVE (hygiene
   only); local `MetabolismSpend` sum vs `get_balance.spent.usd` mismatch → REVOKING
   →`revoke_key`→ NO_KEY (then manual). STARVED → balance recovers above reserve → ACTIVE.
2. **Reserve floor:** fixed **`RESERVE_USD`** env param, default **$3**. `claimSize` /
   `reserveR` drop out of Metabolism (nothing to claim).
3. Budget policy 3rd term: `balance.usd − RESERVE_USD` (was `keyRemaining − reserve`).
4. Build split (CLAUDE.md >200 lines): **M5b-1** MCP client + `pnpm orbio:auth` + 5 typed
   wrappers + fixtures · **M5b-2** 60s lifecycle runner + signed `lifecycle_log` writer +
   `GET /v1/lifecycle` · **M5b-3** `MetabolismSpend` ledger + IDS reconciler (spender is the
   M6 deep-dive; wire call sites in M6).

### Open / next (when the user is back)
- **Answer needed:** run `orbio_delete_key` (reclaim $8.14) / `orbio_create_key` (capture
  secret → `.env` `ORBIO_API_KEY`) / neither (build M5b-1 on recorded fixtures). Nothing
  else in M5b-1 is blocked once this is answered.
- Deps to add (pinned, exact; not in catalog yet): `@modelcontextprotocol/sdk`,
  `@openrouter/agent`, `@openrouter/sdk` — `apps/worker` + workspace `catalog:`. Needs a
  `pnpm install` (network) the user runs.
- Not yet done: apply det_v0.2 base rates to `det_v0_1.json` + `pnpm commit:run --artifacts`
  (user open item #4).
