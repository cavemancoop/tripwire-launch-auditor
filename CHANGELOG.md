# Changelog

## 2026-09-28 — Assessment admission protection candidate (Package 4c)

Repeated requests for one token share its pending BullMQ assessment job. The
API limits free assessment requests to 12 per client IPv4 address or IPv6 /64
and 30 accepted requests globally per minute in Redis. A rejected IP request
does not consume a global slot; HTTP 429 includes `Retry-After`. Trust in
Railway's `X-Real-IP` is opt-in through `TRUST_X_REAL_IP=true` on the API
service. A missing job referenced by a deduplication key is repaired atomically
so one token cannot be blocked forever after a partial Redis restore.

The disposable Redis integration suite covers concurrent producers, successful
and failed job finalization, orphan repair, and shared per-IP/global limits.
Run it with `TEST_REDIS_URL=redis://127.0.0.1:<port>/15 pnpm --filter
@launch-auditor/api test:redis` (or set the environment variable in PowerShell
before invoking pnpm). It refuses non-local or non-15 targets. Before release,
verify the production ingress path and set the opt-in flag accordingly; check
HTTP 429 behavior and core commitment timeliness after deployment.

Append-only. Each entry: what changed, deliberate scope calls, and what the human should verify.

## 2026-09-25 — Fable engineering release candidate (Packages 2b and 4a)

The worker now exposes fixed-label outcome/scorer loop progress on its private
`/metrics` route. Shared RPC error classification and regression tests keep
provider quota and nested rate-limit failures pending for retry, redact
credentials from new outcome diagnostics, and preserve the existing v1
DRAWDOWN_80 grading interpretation. No schema migration or new configuration
is required. Package 4b cancellation and row ownership remains open.

The publishable tree passed Prisma generate/validate, workspace typechecks and
829 Vitest tests. Forge was unavailable and skipped; live RPC and production
database behavior remain to be observed after deployment. See
[`docs/FABLE-RELEASE-STATUS.md`](docs/FABLE-RELEASE-STATUS.md) for scope,
limitations and remaining work.

## 2026-09-24 — Package 2a: worker observation (scheduler by tier, memory)

Observation only. No change to RPC admission order, rate or concurrency,
outcome selection, grading, retries, statuses, schema, migrations, `/health`,
public claims or configuration. No new env var.

- `RequestScheduler.stats` adds per-tier `queuedByPriority`,
  `inFlightByPriority`, `completedByPriority` and `failedByPriority`, next to
  the existing `byPriority`. `allSchedulerStats()` returns every scheduler's
  stats without its URL.
- The worker health server adds `GET /metrics`: 38 fixed Prometheus series
  (RPC started/completed/failed/queued/in-flight by tier, process memory, peak
  RSS, heap limit, uptime). It is private-network only. If the collector or
  formatter throws, `/metrics` returns a fixed `503 metrics unavailable`
  without the exception text, and `/health` stays independent and
  byte-identical (review revision).
- The worker logs one `[obs] {json}` line every 60 s. It is a bounded
  operational subset of the Prometheus metrics: per-tier RPC counts, plus rss,
  heapUsed, heapTotal and maxRss rounded to MB, and uptime. It omits
  `external`, `array_buffers` and `heap_limit_bytes`.

### Verify
```bash
pnpm --filter @launch-auditor/rpc-budget exec vitest run test/scheduler.test.ts
pnpm --filter @launch-auditor/worker exec vitest run test/observability.test.ts
pnpm verify
```
Check: the original scheduler ordering, concurrency, failure and rate tests are
unmodified and pass. Start order is identical with stats read mid-flight.
`/health` returns the same bytes as before, including right after a failed
`/metrics` request on the same server.

## 2026-09-24 — F01 regression tests: zero-swap DRAWDOWN_80 stays UNRESOLVABLE

Tests only; no resolver, rule, row or migration change. Ported verbatim from
reviewed commit f20c3e4 (branch `fix/f01-m4a-hold`).

- The unreleased M4a change (local f269962) gave a launch/qualified 24h row
  with zero reference swaps a quoter baseline at the horizon block. The
  horizon price was then the identical `eth_call`, so the row resolved false
  with ratio 1. F01 withdrew M4a. This branch's `resolve-drawdown.ts` is
  already the pre-M4a code (identical to 21e9ebd and f20c3e4).
- Three tests in `outcomes-price.test.ts` pin that behavior. Same-block and
  earlier-refEnd zero-swap windows return
  `UNRESOLVABLE 'no positive price in the reference window'` with zero
  `eth_call`s. The withdrawn `DRAWDOWN_NO_SWAP_BASELINE` variable has no effect.

### Verify
```bash
pnpm --filter @launch-auditor/worker exec vitest run test/outcomes-price.test.ts
pnpm verify
```

## 2026-09-23 — worker OOM containment: bound scorer snapshot memory

Railway restarted the production worker after an out-of-memory event. Resource
metrics showed a normal ~0.4–0.5 GB footprint with periodic scorer-correlated
spikes to 3–6 GB; the final sampled minute reached 6.1 GB immediately before
the restart. Logs showed every scorer tick failing at the unbounded
`prisma.report.findMany()` while the watcher and commit loops otherwise kept
working.

- Scorer database reads now select only the columns scoring consumes. They no
  longer materialize report `canonicalJson`/evidence/coverage/signatures,
  outcome evidence/coverage, or unrelated feature provenance.
- Scanner features are filtered in Postgres instead of loading every feature
  and discarding most of them in Node.
- The all-inclusive and live-only scoring passes now run sequentially rather
  than holding two full query/result graphs concurrently.
- `SCORER_LOOP_ENABLED=0` is an emergency kill switch. It disables only
  periodic recomputation; the API continues serving the last snapshot already
  persisted in Postgres, protecting launch detection and on-chain commitments.
- The scorer-loop test now pins single-pass concurrency and the kill-switch
  parser.

Verification: `pnpm verify`.

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

## M5b-1 — Orbio MCP client + `pnpm orbio:auth` + 5 typed wrappers (2026-09-09)

Built against live Orbio. The user chose "run it live": `pnpm orbio:probe --yes`
called every wrapper once, including the one-way `orbio_delete_key`. Fixtures are
the real responses (secrets scrubbed); schemas are calibrated to them.

### Added
- Catalog (pinned exact, latest on npm 2026-09-09): `@modelcontextprotocol/sdk` `1.30.0`,
  `zod` `4.6.1`. Added to `apps/worker` deps. **`pnpm install` is the user's to run.**
- `apps/worker/src/metabolism/token-store.ts` — extended with a persisted OAuth store:
  one AES-256-GCM blob (`{clientInformation, codeVerifier, tokens}`) at
  `<repo-root>/.orbio/token-store.enc.json` (gitignored; `ORBIO_TOKEN_STORE` overrides).
  `readOAuthBlob` / `writeOAuthBlob` / `updateOAuthBlob` (merge; `null` deletes a field).
- `apps/worker/src/metabolism/orbio-client.ts`:
  - `OrbioAuthProvider implements OAuthClientProvider` — file-backed, public client
    (`token_endpoint_auth_method: none`), `redirectToAuthorization` throws
    `OrbioInteractiveAuthRequired` unless an `onAuthorize` hook is wired.
  - `connectOrbio()` — Streamable-HTTP transport to `ORBIO_MCP_URL`; non-interactive,
    maps `UnauthorizedError` → `OrbioNotAuthedError` ("run `pnpm orbio:auth`").
  - `extractToolPayload` / `callOrbioTool` — unwrap the MCP `CallToolResult`
    (structuredContent → single JSON text block), throw on `isError`.
  - 5 wrappers + zod schemas + `validate*` fns: `orbioGetBalance`, `orbioCreateKey`
    (`label` ≤60 guard), `orbioGetKeyStatus`, `orbioRevokeKey`, `orbioDeleteKey`.
    Schemas validate every field Metabolism reads and `.passthrough()` the rest.
- `apps/worker/src/scripts/orbio-auth.ts` — `pnpm orbio:auth`: localhost callback
  listener + browser open + `transport.finishAuth(code)` + a fresh verify connect.
- `apps/worker/src/scripts/orbio-probe.ts` — `pnpm orbio:probe --yes`: calls each
  wrapper once LIVE, writes `apps/worker/test/fixtures/orbio/<tool>.json` (secrets
  redacted), writes the minted key to `.env` `ORBIO_API_KEY`, prints before/after
  balance + key status. Refuses to run without `--yes` (3 of 5 calls mutate; one is
  one-way). Call order: get_balance → get_key_status → create_key → revoke_key → delete_key.
- `apps/worker/test/orbio-client.test.ts` — `extractToolPayload`, schema-vs-fixture
  for all five, wrappers against a stub client, `OrbioAuthProvider` encrypted round-trip.
- `.env.example` — M5 block reworked: `RESERVE_USD=3` (replaces `METABOLISM_RESERVE_R`
  / `_CLAIM_SIZE_USD` per the 2026-09-09 decision), `ORBIO_OAUTH_CALLBACK_PORT`,
  `ORBIO_TOKEN_STORE`, `ORBIO_API_KEY`. README "Metabolism" section.

### Live probe — RAN (2026-09-09, user authed, all 5 wrappers called once)

Real responses recorded in `apps/worker/test/fixtures/orbio/` (API-key material
scrubbed: `key`/`prefix`/`legacy.label` → `sk-…-REDACTED`; wallet + USD figures kept).
Schemas in `orbio-client.ts` were then tightened to the exact shapes:

| tool | shape learned |
|---|---|
| `orbio_get_balance` | `wallets[]`, and `accrued/purchased/deposited/depositBalance/spent/claimed/balance` each `{usd:number, microUsd:string}`, plus `depositFrozen:bool` |
| `orbio_get_key_status` | `hasKey`, `prefix`/`createdAt`/`lastUsedAt` (nullable), `baseUrl`, `anthropicBaseUrl`, `legacy: {label,limitUsd,usageUsd,remainingUsd,disabled,readable} \| null` |
| `orbio_create_key` | `{ key, prefix, baseUrl, anthropicBaseUrl, replaced:bool }` — `replaced:true` = it retired the old key |
| `orbio_revoke_key` | `{ revoked: true }` |
| `orbio_delete_key` | `{ refunded: {usd,microUsd}, label }` |

**Account state moved (irreversible parts as expected):**
- balance.usd `24.011879` → `~32.15` (delete_key refunded the legacy key's `$8.137950`)
- `accrued $209.69`, `claimed $150.68`, gateway `spent $0`
- old gateway key `sk-orbio-HCfJKw` retired by `create_key`; the key it minted was
  then **revoked** (step 4) — account now has **no gateway key**
- legacy OpenRouter key `sk-or-v1-a62…aed` (`remainingUsd $8.14`) **deleted / disabled** — one-way
- `.env` `ORBIO_API_KEY` blanked (probe wrote it, step 4 revoked it — it was dead on arrival)

### Verify — GREEN
`pnpm verify` passes: typecheck (all pkgs) + 155 worker tests (19 new in
`orbio-client.test.ts`) + rpc-budget + api. Forge skipped (not on PATH, as usual).

### Not done (later M5b)
- M5b-2: 60s lifecycle runner + signed `lifecycle_log` writer + `GET /v1/lifecycle`.
- M5b-3: `MetabolismSpend` ledger + IDS reconciler.
- `@openrouter/agent` / `@openrouter/sdk` — deferred to M6 (not needed for M5b-1).

## M5b-2 — lifecycle runner + signed lifecycle_log writer + GET /v1/lifecycle (2026-09-09)

### Added
- `apps/worker/src/metabolism/lifecycle-runner.ts`:
  - `decideLifecycle(reading, cfg)` — **pure**; the adapted §8 machine from the
    2026-09-09 decisions. Drives `metabolism/state.ts` (`checkAgainstStateMachine`
    asserts every emitted `(from,event,to)` is a real `nextState` edge). Adaptations:
    `balance − RESERVE_USD ≤ 0` → STARVED directly (never drain-then-rotate);
    ROTATING is hygiene-only; ledger-vs-provider spend mismatch → REVOKING → NO_KEY
    then **halt** (in-memory + reseeded from the last row's `idsMismatch`, cleared
    only by a worker restart / manual re-auth); key present at Orbio but its secret
    not in the store → revoke + remint.
  - `LifecycleLogWriter` — hash-chained, agent-signed append to `lifecycle_log`.
    Keeps `prevHash` in memory (seed via `.fromDb`), sets `createdAt` explicitly to
    the signed `at` so rows re-verify. Injectable persistence (`LifecyclePersist`).
  - `runLifecycleLoop(signal)` — 60s poll of `orbio_get_balance` +
    `orbio_get_key_status`; one transition row per change + one snapshot per tick;
    reconnects the MCP client on error. `METABOLISM_STATUS_POLL_SEC` cadence.
- `packages/db/src/lifecycle-chain.ts` (new; `packages/db` gains `viem` + `canonicalize`):
  `GENESIS_HASH`, `lifecycleBodyHash(body)` (keccak256 of RFC-8785 canonical JSON),
  `verifyLifecycleRows(rows)` → `{ linked, startsAtGenesis, brokenAt, length }`.
  One canonicalisation shared by the worker writer and the API. `metabolism/lifecycle.ts`
  now delegates its hash to `lifecycleBodyHash` (behaviour unchanged; 17 metabolism tests still green).
- `apps/api` (gains `@launch-auditor/db`): `GET /v1/lifecycle?limit=200` (spec §9) —
  rows oldest→newest + server-side `verified` / `startsAtGenesis` / `brokenAt` +
  a `verification` block describing the offline check. Injectable reader for tests.
- `apps/worker/src/index.ts` — starts `runLifecycleLoop` when `AGENT_EIP712_PRIVATE_KEY`
  and `TOKEN_ENCRYPTION_KEY` are both set (logged disabled otherwise).
- `metabolism/state.ts` — added `ACTIVE + NO_CREDITS → STARVED` (the one edge the
  adapted drain path needs; existing transitions untouched).
- `token-store.ts` — `OrbioOAuthBlob` gains `gatewayKey` / `gatewayKeyPrefix`
  (minted key persisted encrypted so a restart doesn't orphan it; cleared on revoke).
- `env.ts` — `metabolismReserveUsd` (`RESERVE_USD`, 3), `metabolismLowWaterUsd`
  (`METABOLISM_LOW_WATER_USD`, default 2×reserve), `metabolismHygieneRotateDays` (7),
  `metabolismStatusPollSec` (60), `metabolismIdsToleranceUsd` (0.01). `.env.example` updated.
- Tests: `apps/worker/test/lifecycle-runner.test.ts` (32 — every `decideLifecycle`
  branch, state-machine agreement, writer hash-chain + signature recovery + tamper),
  `apps/api/test/lifecycle.test.ts` (4 — serve/verify, tamper→`verified:false`, limit clamp, empty).

### Verify — GREEN
`pnpm verify`: typecheck (6 pkgs) + 187 worker tests + 5 api tests + rpc-budget/db/scoring/chain.
No new migration — `lifecycle_log` already has every column (init migration); the runner
sets `createdAt` explicitly rather than adding a signed-`at` column.

### Not done (M5b-3)
- `MetabolismSpend` ledger writes + the real IDS reconciler (per-key, not a global Σ).
  M5b-2 wires the inputs: `ledgerSpendUsd` = `Σ MetabolismSpend.costUsd` (0 until M6),
  `providerSpendUsd` = `orbio_get_balance.spent.usd`.

## M5b-3 — MetabolismSpend ledger + per-key IDS reconciler (2026-09-09)

### Added
- `apps/worker/src/metabolism/spend-ledger.ts` — `recordSpend` / `totalSpendUsd` /
  `spendByKey` over the `MetabolismSpend` table. One row per `llm_deepdive_v0` run,
  **idempotent on the OpenRouter `generationId`** (a retried generation is never
  double-counted). Rejects negative / non-finite `costUsd`. Storage seam
  (`SpendStore`) so it is unit-tested without Postgres. **The spender is the M6
  deep-dive — M6 wires the call sites**; M5b-3 is the write/read surface + reconciler.
- `apps/worker/src/metabolism/ids-reconcile.ts` — `reconcileIds` (pure). Orbio only
  exposes an account-wide gateway `spent.usd`, so the IDS check runs against a
  **per-key baseline**: the runner snapshots `(provider spent, ledger Σ)` into the
  encrypted store (`OrbioOAuthBlob.spendBaseline`) when a key is minted, and each
  tick compares the two deltas since. `mismatch` fires only when the provider
  outpaces the local ledger by `> max(idsToleranceUsd, idsGraceUsd)` — the
  compromise direction. Ledger-ahead (unsettled / over-recorded) → `direction:
  'ledger_ahead'`, logged, never revoked. No baseline / key mismatch →
  `'no_baseline'`, no action.
- `lifecycle-runner.ts` integration:
  - `LifecycleReading.ids: IdsReconcile`; `decideLifecycle` now reads `r.ids.mismatch`
    / `r.ids.reason` instead of recomputing a naive `abs(ledger − provider)`.
  - each tick: `totalSpendUsd()` for the ledger Σ → establish/refresh the per-key
    baseline if missing → `reconcileIds` → feed `decideLifecycle`. `mint()` writes a
    fresh baseline for the new key; the revoke path clears it.
  - `LifecycleConfig.idsGraceUsd`, `env.metabolismIdsGraceUsd`
    (`METABOLISM_IDS_GRACE_USD`, default `DEEPDIVE_CAP_PER_RUN_USD + 0.05`).
- `token-store.ts` — `OrbioOAuthBlob.spendBaseline?: SpendBaseline`.
- Tests: `apps/worker/test/spend-ledger.test.ts` (5 — insert, generationId
  idempotency, no-id insert, validation), `apps/worker/test/ids-reconcile.test.ts`
  (8 — no baseline, wrong key, provider-ahead, within-grace, ledger-ahead, exact,
  tolerance floor). `lifecycle-runner.test.ts` updated for the `ids` field (+1 test:
  IDS mismatch does not act from NO_KEY / STARVED / REVOKING).

### Verify — GREEN
`pnpm verify`: typecheck (6 pkgs) + 201 worker tests (+14) + 5 api tests. No migration
(`MetabolismSpend` already in the M5 metabolism-ledger migration).

### Not done (M6)
- The deep-dive that actually calls `recordSpend(...)` with the OpenRouter usage +
  `GET /api/v1/generation?id=` cost, tagged with the current `keyHashPrefix`.

## M6a — deep-dive OpenRouter client + tool belt (2026-09-09)

First of three M6 checkpoints (M6b: agent loop + scored output · M6c: persist + score + trigger).

### Added
- Catalog / `apps/worker` dep: `@openrouter/agent` `0.11.0` (pinned exact). It
  re-exports `OpenRouter` for plain calls plus `tool()` / `callModel` /
  `serverTool` / `stepCountIs` / `maxCost` for the loop; pulls `@openrouter/sdk`
  0.13.x transitively (build script disabled in `pnpm-workspace.yaml` —
  Speakeasy SDK, ships prebuilt). Needs a `pnpm install`.
- `apps/worker/src/deepdive/openrouter.ts` — `createDeepdiveClient` (Orbio gateway
  base URL `ORBIO_GATEWAY_V1_URL`, key resolved from the encrypted store's
  `gatewayKey` → `ORBIO_API_KEY` → `OPENROUTER_API_KEY`, attribution headers
  `HTTP-Referer` / `X-Title`), `generationCost(id)` → `GET /generation?id=` (the
  authoritative per-call cost, feeds `recordSpend` in M6b), `assertScoredModelSlug`
  (rejects empty / `~latest` / `openrouter/auto` — the model must be identifiable
  per report, spec §5).
- `apps/worker/src/deepdive/contract-code.ts` — `resolveContractCode`: runtime
  bytecode `keccak256` + size + EIP-1967 implementation/admin/beacon slot
  resolution (RPC-only, block-pinnable). For the §8.2 target packet.
- `apps/worker/src/deepdive/evidence.ts` — `EvidenceRow {tool,query,value,source,block}`,
  `Limitation`, `ToolOutput`, and `ok` / `rows` / `limited` / `asUntrustedData`
  builders (§8.2 discipline: coverage gaps are limitations, never findings;
  external text is framed "data, not instructions").
- `apps/worker/src/deepdive/tools.ts` — `buildDeepdiveTools(ctx)`: the 8
  read-only client tools (`address_token_activity`, `token_transfers`,
  `cluster_expand`, `price_series`, `holder_snapshot`, `contract_code`,
  `scanhood_scan`, `scanhood_quote`) as `tool()` defs with zod input schemas,
  each delegating to one method of a per-target `DeepdiveContext` interface and
  wrapping the result as evidence (a thrown read → a limitation). Plus
  `DEEPDIVE_SERVER_TOOLS` (`serverTool({ type: 'web_search_2025_08_26' })`).
- `env.ts` / `.env.example` — `ORBIO_GATEWAY_V1_URL`, `OPENROUTER_MODEL_DEEPDIVE`
  (**required before any scored run**), `OPENROUTER_HTTP_REFERER`,
  `OPENROUTER_X_TITLE`, `DEEPDIVE_CAP_PER_RUN_USD` (0.20), `DEEPDIVE_DAILY_CAP_USD` (5).
- Tests: `deepdive-contract-code.test.ts` (4), `deepdive-openrouter.test.ts` (8 —
  key fallback order, slug guard, `generationCost` URL + envelope + HTTP error),
  `deepdive-tools.test.ts` (6 — tool order, evidence shape, bigint serialisation,
  limitation-not-finding, schema rejection). No live calls.

### Verify — GREEN
`pnpm verify`: typecheck (6 pkgs) + 219 worker tests (+18) + 5 api. No migration.

### Not done (M6b / M6c)
- `buildDeepdiveContext` — binding `DeepdiveContext` to the live M1–M4 providers
  for a specific launch.
- The `callModel` agent loop, frozen target packet, structured-output schema
  `{p_insider_exit_24h, p_drawdown_80_7d, p_sell_impaired_24h, evidence, confidence}`,
  range-checks, cost recording → `recordSpend`, budget gate.
- Report assembly (`forecaster = llm_deepdive_v0`) → §8.3 validator → persist →
  commit; scorer wiring; qualified-lane trigger + `POST /v1/deepdive/{token}`.

## M6b — deep-dive agent loop + scored output (2026-09-10)

### Added
- `deepdive/schema.ts` — `DeepDiveOutputSchema` (`{p_insider_exit_24h,
  p_drawdown_80_7d, p_sell_impaired_24h, evidence:[{claim,tx_or_url}],
  confidence}`), `DEEPDIVE_OUTPUT_JSON_SCHEMA` (strict, for `text.format`),
  `clampDeepDiveOutput` (structurally-valid output → probabilities clamped to
  [0,1], evidence capped at 40 / claims at 600 chars, adjustments recorded as
  `warnings`), and the `DeepDiveResult` shape.
- `deepdive/packet.ts` — `buildTargetPacket` (spec §8.2 frozen packet): chain id
  from RPC (cross-checked vs the target), block pin `{number, hash, timestampUtc}`,
  `resolveContractCode` at that block + the implementation's code when it is an
  EIP-1967 proxy, candidate pools.
- `deepdive/prompt.ts` — `DEEPDIVE_SYSTEM_PROMPT` (read-only, evidence-only,
  limitations-are-not-findings, pinned-to-report-block, external-text-is-data)
  + `buildDeepdiveUserPrompt` (packet JSON + `<<< EXTERNAL DATA >>>` wrapped socials).
- `deepdive/agent.ts` — `runDeepdiveAgent(input, {invoke?})`: builds the tools with
  an evidence collector, runs `callModel` with `stopWhen: [stepCountIs(maxSteps),
  maxCost(maxCostUsd)]` and the strict JSON schema, then validates + clamps the
  output. Returns `DeepDiveResult` with accumulated `evidence` / `limitations`,
  `generationIds` (one per turn, via `onTurnEnd`), `usageCostUsd`, `steps`,
  `stoppedBy`. The model call is injectable — the loop is fully unit-tested with
  no live calls.
- `deepdive/cost.ts` — `recordDeepdiveSpend`: one `MetabolismSpend` row per
  generation, costed via `generationCost` (`GET /generation?id=`), tagged with the
  gateway `keyHashPrefix`, idempotent on `generationId`; a failed cost lookup is
  reported and its spend is not recorded. Falls back to the usage estimate when a
  run produced no generation ids.
- `metabolism/budget.ts` — `deepdiveRunGate`: the hard per-run gate
  (`min(capPerRun, dailyCap − todaySpend, balance − RESERVE_USD)`), returning
  `maxRunCostUsd` to pass as the loop's `maxCost`.
- `deepdive/tools.ts` — `buildDeepdiveTools` gains an `onResult` collector param
  (refactored to a shared `guard` — the try/catch → limitation is now uniform).
- Tests: `deepdive-schema` (9), `deepdive-packet` (3), `deepdive-agent` (5),
  `deepdive-cost` (4), `deepdiveRunGate` (4 in `metabolism.test.ts`). No live calls.

### Verify — GREEN
`pnpm verify`: typecheck (6 pkgs) + 243 worker tests (+24) + 5 api. No migration.

### Not done (M6c)
- `buildDeepdiveContext` — bind `DeepdiveContext` to the live M1–M4 providers for a
  `Launch` row (RPC-logs history, cluster, price series, holders, ScanHood).
- `deepdive/run.ts` — `Launch` → packet → agent → assemble a `Report`
  (`forecaster = llm_deepdive_v0`, version = model slug) → §8.3 validator →
  persist → eligible for the Merkle commit loop; `recordDeepdiveSpend` at the call site.
- Scorer/benchmark wiring; `deepdive` BullMQ worker (qualified lane, budget-gated);
  `POST /v1/deepdive/{token}`.

## M6c — deep-dive persist + score + trigger (2026-09-10)

Completes M6. `llm_deepdive_v0` now produces signed, §8.3-validated reports that
the existing scorer picks up unchanged (it is report-backed like `det_v0`).

### Added
- `deepdive/report.ts` — `assembleDeepdiveReport` / `assembleDeepdiveReportSigned`:
  the three deep-dive probabilities → `INSIDER_EXIT@24h` / `DRAWDOWN_80@7d` /
  `SELL_IMPAIRED@24h`; `confidence` + `evidence` carried on the report; limitations,
  chain-id mismatch and clamp warnings folded into `coverage`; block pin from the
  packet; EIP-712 signed with the agent key; run through the §8.3 validator.
- `deepdive/context.ts` — `buildDeepdiveContext(launch, {rpc, scanhoodBaseUrl}, cfg)`:
  binds the 8 `DeepdiveContext` methods to the live M1–M4 providers
  (`RpcLogsAddressHistory`, `getLogsChunked`, `buildCreatorCluster`,
  `buildPriceSeries`, `computeHolderStats`, `resolveContractCode`, ScanHood).
- `deepdive/run.ts`:
  - `runDeepdive({launchId, trigger, reportBlock?, force?}, deps?)` — pinned-slug
    check → budget gate (`deepdiveRunGate` with today's `MetabolismSpend` Σ + the
    latest lifecycle snapshot's spendable balance) → `buildTargetPacket` →
    `buildDeepdiveContext` → `runDeepdiveAgent` (maxCost = `min(gate, per-run cap)`)
    → assemble + sign + validate → `persistLaunchReports` → `recordDeepdiveSpend`
    tagged with the gateway `keyHashPrefix`. All I/O injectable — fully unit-tested.
  - `sweepDeepdiveEligible` / `runDeepdiveLoop` — periodic scan of qualified-lane,
    non-retrospective, T+10m-complete launches without an `llm_deepdive_v0` report;
    stops early when the budget is exhausted.
  - `startDeepdiveWorker` — BullMQ consumer of the `deepdive` queue for on-demand runs.
- `apps/api` (gains `bullmq`): `POST /v1/deepdive/{token}` (spec §9) — validates the
  address, enqueues `{tokenAddress, trigger:'on_demand'}` on the `deepdive` queue,
  returns 202. Free during the contest; x402 / API-key gating is M7. Enqueuer
  injectable (`apps/api/src/deepdive-queue.ts`).
- `apps/worker/src/index.ts` — starts `runDeepdiveLoop` + `startDeepdiveWorker` when
  `OPENROUTER_MODEL_DEEPDIVE` and `AGENT_EIP712_PRIVATE_KEY` are both set.
- `report/types.ts` + `report/persist.ts` — `ReportContent` gains optional
  `confidence` / `evidence`, persisted to the `Report` columns (the deterministic
  forecasters omit them, so their canonical JSON / hashes are unchanged).
- `env.ts` / `.env.example` — `DEEPDIVE_MAX_STEPS` (12).
- Tests: `deepdive-report` (6), `deepdive-run` (5 — full pipeline, slug guard,
  budget-blocked-no-agent-call, already-scored skip, maxCost cap), `deepdive-endpoint`
  (3, api). No live calls.

### Scoring
No scorer change needed — `collectScoreRows` / `scoreBenchmark` are forecaster-agnostic
and read the standard probability columns, so `llm_deepdive_v0` appears in the §2
benchmark table and its comparisons vs `det_v0` automatically once reports resolve.

### Verify — GREEN
`pnpm verify`: typecheck (6 pkgs) + 254 worker tests (+11) + 8 api tests (+3). No migration.

### Not done (later)
- The scored model slug — set `OPENROUTER_MODEL_DEEPDIVE` to a pinned exact slug
  before the first live run; `runDeepdive` refuses otherwise.
- x402 / API-key gating on `POST /v1/deepdive` (M7).
- The `evm-token-due-diligence` skill's eleven separately-rated surfaces (spec §8.2)
  — v0 ships the three outcome probabilities + evidence ledger only.

## M5c — billing basis, epoch reconciliation, PHANTOM_SPEND (2026-09-12)

Fixes the 2026-09-12 near-failure and the design error under it. Five live
deep-dives had produced five validator-passed reports and **zero ledger rows**:
the Orbio gateway 404s OpenRouter's `GET /api/v1/generation` (verified —
`/api/v1/models` returns 200, `/generation` returns 404 with an HTML body) and its
usage object carries token counts but no cost. The IDS reconciler read an empty
ledger against growing provider spend as a compromised key and, at the $0.01
default, would have revoked the agent's own key during the overnight
unattended run. A `$100` tolerance was applied as a stopgap; this replaces it.

One `spend` number had been doing three jobs. Now (external review, adopted):

| job | source |
|---|---|
| what Orbio actually charged | `orbio_get_balance.spent.usd` → `MetabolismEpoch.providerDeltaUsd` (authoritative) |
| which report caused it | tokens × pinned price → `MetabolismSpend.costUsd` + `costBasis` |
| is the agent safe to run | three controls → `LifecycleLog.billingStatus` |

### Added
- `deepdive/pricing.ts` — published per-M prices for the pinned slugs,
  `PRICING_VERSION`, `estimateCostUsd()`; an unpriced model yields `null`, never a guess.
- `metabolism/reconcile.ts` — `reconcileEpoch()`: provider delta over the tick
  vs Σ local estimates → `reconciliationFactor`, signed `discrepancyPct`,
  `phantom`, `anomaly`, `billingStatus`. Pure. `billingBlocksInference()`.
- Schema (`m5c_billing_basis_and_epochs`): `MetabolismSpend` +`promptTokens`,
  `completionTokens`, `estimatedCostUsd`, `pricingVersion`, `costBasis`
  (`provider_reported | provider_generation | token_estimate |
  provider_reconciled_estimate | unavailable`), `reconciledCostUsd`, `epochId`;
  new `MetabolismEpoch`; `LifecycleLog.billingStatus` (stored, **not** in the
  signed body — every older row still verifies).
- `state.ts` — `PHANTOM_SPEND` event → REVOKING from any keyed state. The one
  signal that means someone else holds the key. `IDS_MISMATCH` retained so old
  rows replay; the runner no longer emits it.
- `GET /v1/lifecycle` — `billingStatus` per row + an `estimator` block
  (trailing-24h provider spend, estimated spend, request count, mean
  |discrepancy|, latest window). The metabolism forecasting its own cost and
  being graded on it, like every other forecaster in the project.
- Env: `METABOLISM_ANOMALY_PCT` (50), `METABOLISM_ANOMALY_EPOCHS` (3),
  `METABOLISM_PHANTOM_TOLERANCE_USD` (0.005). `METABOLISM_IDS_TOLERANCE_USD`
  back to 0.01, advisory only.

### Changed
- `deepdive/agent.ts` — reads `prompt_tokens` / `completion_tokens` (any common
  spelling) as well as a provider cost from the usage object.
- `deepdive/cost.ts` — one row per run with a basis, precedence
  `provider_reported > provider_generation > token_estimate > unavailable`.
  A failed `/generation` lookup falls through to the estimate; it is never $0
  and never silent.
- `lifecycle-runner.ts` — every tick is an epoch: reconcile, persist the epoch,
  stamp the window's rows with the factor (→ `provider_reconciled_estimate`),
  track consecutive anomalies. **An IDS ledger/provider gap no longer revokes.**
  `decideLifecycle` revokes only on `phantomSpend`. A housekeeping revoke
  (secret not in the store) no longer marks the row `idsMismatch`, so a restart
  does not halt on it.
- `budget.ts` — the daily cap is enforced against
  `max(local estimate, Σ provider deltas today)`; `billingStatus` of
  `anomaly` / `phantom` closes the gate with `maxRunCostUsd: 0`. `run.ts`
  supplies both from the latest epoch / lifecycle row.

### M6 acceptance criterion — rewritten
"Cost appears in the ledger" tested a detail the gateway does not expose. Now:
*after controlled inference, authoritative provider spend increases; local
aggregate spend reconciles to the provider total within the anomaly band; every
displayed per-report cost declares its attribution basis.*

### Not built (roadmap, DECISIONS.md)
Progressive analysis tiers; deduplicated launch state keyed on
`token + analysis_version + evidence_timestamp`; local velocity control; the
upstream ask to Orbio for per-request cost headers or `orbio_get_usage(since)`.
The serialized balance-delta probe was considered and rejected — right for
10–15 runs/day, wrong shape for a query-driven product.

### Verify — GREEN
`pnpm verify`: typecheck (6 pkgs) + 277 worker tests (+21: pricing 6, reconcile
+ gate 11, state 1, cost 7 rewritten, lifecycle 4 flipped) + 8 api. Migration applied.

### M5c follow-up — the re-auth kept dying (2026-09-12, ~04:20 UTC)

`pnpm orbio:auth` succeeded (its own verify connect passed) and the worker still
reported `not authorized` every tick; the store held a registered client and a
fresh PKCE verifier but **no tokens**, rewritten every 60s. Mechanism, from the
SDK source: the transport calls `auth()` only after a **401**; `auth()` then sees
a stored `refresh_token`, tries `refreshAuthorization`, Orbio answers
`invalid_grant`, and the SDK calls `invalidateCredentials('tokens')` — wiping
the token — before starting an authorize it cannot finish non-interactively.
A worker tick whose in-flight request pre-dated the sign-in got a 401, then
found and destroyed the user's fresh token. Same mechanism as the ~2.5h
overnight lapse; only the trigger differed.

Root cause — corrected after measuring it directly (the first draft of this
entry said the grant was rejected outright; it is not): **Orbio's refresh grant
is one-shot.** First use → HTTP 200 with no replacement `refresh_token` in the
body; any later use of the same token → 400 `invalid_grant`. The SDK's
`refreshAuthorization` keeps the old token when no new one arrives, so the
second refresh always fails, and the SDK treats that as fatal. That is the whole
overnight story: 1h access token + one refresh ≈ the ~2.5h observed. Holding a
refresh token therefore makes the *second* 401 destructive — and a re-auth race
makes the *first* one destructive for whichever process loses.

- `OrbioAuthProvider.tokens()` withholds `refresh_token` from the SDK unless
  `ORBIO_OAUTH_USE_REFRESH=1`. A 401 now means "re-auth needed"; the access
  token stays on disk and a subsequent tick simply uses it, so a race with an
  in-progress sign-in self-heals.
- `saveCodeVerifier()` persists only when interactive (`onAuthorize` set); the
  worker keeps its verifier in memory and no longer overwrites the one
  `pnpm orbio:auth` is waiting to exchange.
- `connectOrbio` says *why*: "no token on disk" vs "stored token was rejected
  by the server (401)" — different failures need different responses.
- `orbio:auth` opens the URL with `rundll32`, not `cmd /c start` (`&` split).
- 7 tests (`orbio-auth-provider.test.ts`).

Still true: without a working refresh, the session is bounded by the access
token's lifetime. That bound is the number to publish, not something to hide.

## M7 — API endpoints, MCP server, fork-and-run (2026-09-12)

Implements spec §9 and §8.1. x402 payment gating deferred again (still no time
left after the free endpoints) — API-key echo only, nothing gated yet.

### Added
- `apps/api` routes: `GET /v1/launches`, `GET /v1/report/:token`,
  `POST /v1/assess/:token` (enqueues a one-shot on-demand det_v0/heuristic_v1
  report — the spec's recurring "daily re-scores for 7 days" is v0.3 Watch,
  not this), `POST /v1/deepdive/:token`, `GET /v1/benchmark`,
  `GET /v1/proof/:hash` (Merkle-verified locally, best-effort on-chain
  confirmation via `BatchCommitted` — an RPC hiccup is `onChainConfirmed: null`,
  never `false`), `GET /v1/lifecycle` (unchanged from M5b-2/M5c, now alongside
  the rest of the surface).
- `POST /mcp` — stateless `StreamableHTTPServerTransport` + `McpServer`
  exposing `get_report`, `get_benchmark`, `request_deepdive`: the same reads
  and enqueues, no HTTP client needed.
- `apps/worker/src/assess.ts` + a BullMQ `assess` queue/worker, mirroring the
  deep-dive producer/consumer split (API enqueues, worker owns chain access).
- `scripts/start.mjs` — `pnpm start` spawns worker + api as children, forwards
  prefixed stdio, brings both down together on SIGINT or either child's exit.
  No new dependency.
- `apps/api/src/merkle.ts` — `verifyProof`/`hashPair` duplicated from
  `apps/worker/src/commit/merkle.ts` (apps can't import each other's `src/`;
  ~10 stable lines, not worth a shared package).
- README: fork-and-run (3 steps) + the full endpoint table.

### Fixed post-merge (same day)
- `.gitignore`'s `data/` pattern had a trailing same-line `#` comment, which
  git does not treat as a comment — the literal pattern never matched anything.
- The worker (`scorer/loop.ts`) and API (`env.ts`) both defaulted
  `benchmarkFile` to the bare relative `data/benchmark.json`; `pnpm --filter X
  start` sets cwd to that package's own directory, so the two processes wrote
  and read two different files and `GET /v1/benchmark` could never see what the
  worker had written. Both now anchor to the repo root via a duplicated
  `findRepoRoot()` (walks up for `pnpm-workspace.yaml`).
- `runScorer()` (`scorer/benchmark.ts`) called `writeFileSync` with no
  preceding `mkdirSync`, unlike the loop version — the one-shot `scorer:run`
  CLI script ENOENT'd on a repo that had never had a long-running loop create
  `data/` first. Added the same `mkdirSync(dirname(...), { recursive: true })`.

## M8 — Dashboard and free feed (2026-09-12)

Build-guide M8: a static dashboard + a Telegram poster, free feed for launches
past the API. No new claims beyond spec §0.

### Added
- `apps/web` — no build step, no framework: a dependency-free static file
  server (`node:http`) serving plain HTML/CSS/JS. Every number renders from a
  raw API field or a labelled derivation; nothing is invented when data is
  thin (renders "n/a" / an explicit note instead). Panels, in spec §0.1's
  order: Metabolism (active key remaining, credits accrued/hr — derived from
  the lifecycle log's `balanceUsd` samples, spend/report, rotations/
  revocations, billing status, today's budget, chain-verified span); two P&L
  boxes (standalone cash cost vs. Orbio-subsidized, trailing 24h — the spec
  §0.1 red-team question answered in dollars); live launches; benchmark
  (sample sizes, insufficient-sample and "+N retro" badges, beat claims); key
  lifecycle timeline.
- `GET /v1/lifecycle` gains a `budget` block: `apps/api/src/budget-display.ts`
  duplicates the worker's live deep-dive gate formula (same treatment as
  `merkle.ts`) so the dashboard shows the real gate, not a guess — labelled
  where its window (trailing 24h) differs from the gate's own (since 00:00
  UTC).
- CORS: wildcard `Access-Control-Allow-Origin` on every response (every
  endpoint here is public read or free-during-contest write) so the dashboard,
  served from its own port, can call the api client-side.
- The benchmark snapshot loop now runs the scorer twice per tick (`scope:
  'both'` and `'live'`) and writes `{ generatedAt, all, live }`. The gap in a
  cell's `n` between the two is exactly its retrospective (backfill)
  contribution — a "+N retro" badge with no scorer-package changes. The
  one-shot `scorer:run` CLI is unaffected (still writes a raw `Benchmark`).
- `apps/worker/src/telegram/poster.ts` — every `TELEGRAM_POSTER_INTERVAL_MS`,
  posts each qualified-lane, committed, not-yet-posted `det_v0` report's
  summary + Blockscout proof link to `TELEGRAM_CHANNEL_ID`, then stamps
  `Report.telegramPostedAt` (new column) so a restart never double-posts. A
  send failure is logged and left unmarked (retried next sweep); it never
  blocks the rest of the batch. Unset bot token / channel id → logs disabled
  once, does nothing.

### Verify — GREEN
`pnpm verify`: typecheck (7 of 8 packages — apps/web has no TS) + 292 worker
tests (+7: 5 telegram-poster, 2 scorer-loop) + 36 api tests (+10: 6
budget-display, 2 CORS, 2 lifecycle-budget). Manually verified end-to-end
against a live `pnpm start` instance in a real browser: all five panels render
real data, sticky-header scrollable tables, benchmark retro badges match the
worker's actual all-vs-live cell counts.

## M6 follow-up — the web_search server tool breaks the Orbio gateway call (2026-09-12)

After the user re-ran `pnpm orbio:auth`, the lifecycle runner's balance polling
recovered immediately (billing status left `stale`), but the qualified-lane
sweep still produced `0 scored · 5 skipped` with no per-item reason logged.
Probed directly (`runDeepdive` on one eligible launch, then a raw
`callModel` call bypassing our code entirely): every real deep-dive run threw

```
ResponseValidationError: Response validation failed
  cause: ZodError: path ["error","code"] — expected number, received string
```

Root cause, isolated by adding one piece back at a time: a plain structured-
output call to `deepseek/deepseek-v4.1-flash` on the Orbio gateway succeeds;
the identical call with `DEEPDIVE_SERVER_TOOLS` (`web_search_2025_08_26`)
added reproduces the failure every time. The gateway is returning an error
envelope for that tool (unsupported for this model, most likely) with a
string `error.code`; the pinned `@openrouter/sdk`'s own response schema
expects a number there and throws before we ever see Orbio's real error text.
This is a gateway/SDK shape mismatch, not a bug in our code, our schema, or
the model choice — and it explains the earlier silent `0 scored, N skipped`
sweeps with no per-item log (there wasn't one; `sweepDeepdiveEligible` only
logs the reason when a budget check trips the early-exit path).

- `apps/worker/src/deepdive/agent.ts` — `runDeepdiveAgent`'s live `tools`
  array no longer includes `DEEPDIVE_SERVER_TOOLS`. The constant itself is
  untouched (`tools.ts`, still asserted at length 1 by its test) so restoring
  it is a one-line change once Orbio's gateway supports this tool for the
  pinned model.
- Verified end-to-end: `runDeepdive` on the same previously-failing launch now
  returns `ran: true, stoppedBy: 'complete', validatorPassed: true`, a real
  signed report, and a `MetabolismSpend` row with
  `costBasis: 'provider_reconciled_estimate'`, real prompt/completion tokens,
  and `costUsd: 0.001452` — the first real (non-placeholder) `llm_deepdive_v0`
  report and the first real recorded spend this project has produced.
- `pnpm verify`: 292 worker tests unchanged (no test exercised the server
  tool's presence in the live set), typecheck clean.

Scope note: dropping the server tool means the deep-dive currently runs
without OpenRouter's web search — one evidence source, not all of them; the
five other read-only tools (`blockscout`-equivalent address/tx history,
`cluster_expand`, `price_series`, `holder_snapshot`, `contract_code`) are
unaffected. Restoring web search is a roadmap item pending an Orbio-side fix
or a provider/model combination confirmed to support it.

## M9 — Railway deploy (2026-09-12)

Dockerfiles, health/metrics endpoints, and Telegram ops alerts (build-guide
M9). Also: the repo's GitHub remote (`cavemancoop/tripwire-launch-auditor`)
held only a pre-code spec upload — force-pushed local `main` over it so
Railway has something real to build (user-confirmed, private repo).

### Added
- `apps/{api,worker,web}/Dockerfile` — each built with the **repo root** as
  context (Root Directory blank in Railway, Dockerfile Path
  `apps/<name>/Dockerfile`): every app depends on `packages/*` via the pnpm
  workspace protocol and needs the whole monorepo to install. No separate
  compile stage — every app runs via `tsx` directly, so devDependencies
  (tsx, typescript) are needed at runtime and the image isn't pruned to
  `--prod`.
- `.dockerignore` — excludes `node_modules`/`.git`/`data` from the build
  context. Without it, `COPY . .` would have overwritten the image's
  correctly-installed-for-linux `node_modules` with whatever's on the host
  (caught this one before it shipped: a smoke-tested container ran the
  Windows-built `@esbuild/win32-x64` binary and failed on alpine).
- `railway.json` — multi-service config-as-code (api/worker/web, each its own
  Dockerfile + restart policy). If a given Railway version doesn't pick up a
  multi-service `railway.json` automatically, the README's deploy checklist
  gives the same thing as manual per-service dashboard steps.
- `GET /metrics` (api) — hand-rolled Prometheus text exposition (no
  client library; the gauge set is small and stable): watcher staleness,
  commit age, metabolism state, IDS-or-phantom flag, 24h launch/report
  counts. Computed fresh per request from Postgres, same pattern as every
  other `/v1/*` route.
- `apps/worker/src/health-server.ts` — a dependency-free `/health` listener
  for the worker (its loops need no public port to do their job; this is
  just something to probe).
- `apps/worker/src/alerts.ts` — `runAlertLoop`: every tick, evaluates
  STARVED, IDS trip (`idsMismatch` or a phantom-spend epoch), commit lag
  (>10min since the last commit batch formed), and watcher stalled (>5min
  since the cursor advanced), and messages Telegram only on a state
  transition (ok→bad once, bad→ok once, silent in between) — a steady-state
  problem doesn't spam the channel every tick forever. Reuses M8's
  `makeTelegramSender`; posts to `TELEGRAM_ALERTS_CHANNEL_ID`, falling back
  to the free-feed channel if unset.
- `BenchmarkSnapshot` (Postgres, singleton row) — the scorer loop now
  persists there, not only to the local file. Fork-and-run (one machine,
  spec §8.1) can share a filesystem; Railway's api and worker are separate
  services with separate filesystems and no shared volume by default.
  Postgres is the one thing every deployment topology already shares, so
  `GET /v1/benchmark`'s default reader is now Postgres-backed
  (`prismaBenchmarkReader`); the file write and `fileBenchmarkReader` stay
  for local/offline use.
- 24 new tests: `alerts.test.ts` (13), `metrics.test.ts` (5),
  `budget-display.test.ts` carried over, `scorer-loop.test.ts` +2 for the
  persist path.

### Fixed
- `pnpm --filter <app> start` as a container's `CMD` aborts on every
  container start (not just at build time): pnpm's own dependency-status
  check wants to prompt with no TTY present
  (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). All three Dockerfiles now
  `CMD` straight into `tsx`/`node`, bypassing pnpm's wrapper entirely — each
  app's own env/path helpers already walk up from cwd for `.env` /
  `pnpm-workspace.yaml`, so running from `/app` (the repo root) works
  unchanged.
- A second, redundant `prisma generate` after `COPY . .` hit the same
  no-TTY abort (via `pnpm exec`'s own dependency check) — removed; the
  client generated during the earlier `pnpm install` (schema already
  copied in first) was already correct.
- Local port collision: this repo's `.env` sets `PORT=3000` for the api, and
  the worker's new health server would have defaulted to the same `$PORT` —
  both processes load the same `.env` file locally. The worker's listener
  now reads `WORKER_PORT` (default 3010) and never falls back to bare
  `PORT`. `apps/web/server.mjs` now reads `PORT` first (Railway's
  convention) with `WEB_PORT` as the local-dev-only fallback.

### Verify — GREEN
`pnpm verify`: typecheck (7/8 — apps/web has no TS) + 306 worker tests (+11:
alerts 13, scorer-loop persist +2, net of file reorganization) + 41 api
tests (+15: metrics 5, budget-display 6 carried, benchmark-reader coverage
unchanged, CORS/health 2, lifecycle-budget 2). All three Docker images built
and smoke-tested locally (`docker run` + a real `/health` curl) before this
was trusted.

## M9 follow-up — production actually runs the Orbio half (2026-09-14/15)

The M9 entry above left the stack deployed but with nothing Orbio-specific
running: no key, no lifecycle rows, no deep-dives, no spend. This closes most of
that, and corrects a framing the handoff got wrong.

### The correction that mattered
`HANDOFF-2026-09-14.md` said unattended continuity was bounded at ~1h by the
OAuth session. Measured 2026-09-14: **a gateway key keeps billing inference
normally with a session that expired two days earlier.** The session bounds *key
management* — create, revoke, read balance through the MCP — not spending. Two
continuities, not one. Fable's review (`docs/closer-plan-2026-09-14.md`) reached
the same decomposition independently; its proposed mechanism (an OpenRouter-style
`GET /api/v1/key`) turned out not to exist, but the conclusion held via a
stronger test.

So the thing blocking `llm_deepdive_v0` in production was not a continuity
problem at all — it was a missing `ORBIO_API_KEY`. One variable.

### Fixed
- **The staleness gate spent nothing, ever.** `billingStatus: 'stale'` closed
  the deep-dive gate, so the forecaster the whole benchmark exists to grade had
  never run in production. Stale now allows the run against the last known
  balance (or the daily cap when none was ever read) and reports the staleness;
  `phantom` / `anomaly` still stop inference. Recorded as a decision in
  DECISIONS.md rather than left to be inferred from a flag.
- **Forward scan windows ran past the chain head.** The primary-pool
  re-derivation scans +2h from the launch block — 72k blocks at 0.1s — so ~7 of
  8 chunks asked for blocks that didn't exist. Blockmachine clamped silently;
  Chainstack rejects, and the `try/catch` swallowed it, so M4's decoy-pool
  correction had never run on a single production launch. Clamped in
  `pickPrimaryV4Pool` (covers t10 and backfill), 2 regression tests. Confirmed
  fixed in production: zero failures, first real switch logged.
- **The claim gate ignored the ≥30-positives rule.** It lived in the field
  report and never in code, so the only cell that could trip the gate was
  `INSIDER_EXIT@6h` at n=336 with **12** positives. Now enforced, and
  `minPositivesForClaims` ships in the Benchmark object.
- **SELL_IMPAIRED presented as forecastable.** A fixed $100 sell against pools
  of ~$1k median depth is ~10% of the pool: ~90% come back "impaired" on
  entirely honest tokens. It measures liquidity depth, not deception, and no
  notional fixes that. Marked descriptive; structurally cannot render a claim
  badge.
- **The dashboard contradicted the worker.** The budget panel printed
  "next run allows up to $0.00 / binding constraint: zero" while deep-dives were
  scoring at $0.20 each — the API treated an unread balance as an empty one.
  Unread is now `null`, mirrors the worker's own fallback, and says
  `balanceUnknown`. Separately the estimator only read `MetabolismEpoch`, which
  needs a live session, so real recorded spend showed as `requests24h: 0`; it now
  falls back to the ledger and reports `basis` (`epoch_reconciled` |
  `local_ledger` | `none`) — the costBasis discipline applied to the panel.
- **Every visitor had to paste the API URL.** `apps/web` serves `/config.json`
  from `API_BASE_URL`; the page reads it at boot. A saved override still wins.
- **Sweeps hid their own failures.** Only budget reasons were logged, which
  concealed two multi-day outages (a dead model slug, then the missing key).
  Skip reasons are now aggregated and printed.

### Added
- `pnpm railway:push-env` — push `ORBIO_API_KEY` + Telegram vars from the local
  encrypted store and `.env` into a Railway service. Fingerprints only, nothing
  in shell history, `--dry-run` / `--service` / `--only`.
- Feed posts lead with `/v1/proof/<hash>` for that forecast and label the commit
  tx as "Batch anchor (many reports, one Merkle root)" — Merkle batching meant
  consecutive posts all shared one tx, which reads as a bug to a judge.
- `docs/closer-plan-2026-09-14.md` — Fable's review, in the repo rather than
  only in a chat log.

### Measured in production
50 consecutive deep-dives, `5 scored · 0 skipped · 0 error` per sweep, zero
schema-validation failures. Free feed posting, ops alerts armed. The Orbio
gateway exposes **no** key/usage/credits/balance endpoint (14 paths probed;
`/api/key` returns 405 not 404 — the route exists but rejects GET, almost
certainly the POST behind `orbio_create_key`, deliberately not probed since that
call mints *and retires* the active key).

### Still open
Property 2 (the accrual-driven budget) remains unimplemented, and because
balance is only readable with a live session, it can only be made visible during
that window — the session push it depends on is designed but not built. See
`HANDOFF-2026-09-15.md` §2.

## 2026-09-15 — item 4 (session push) + commit receipt fix

### Added
- `pnpm railway:push-env --with-session` — after checking the local session
  actually works (`listTools` only), pushes `ORBIO_SESSION_SEED` (client
  registration + access token, re-encrypted; no gateway key, no refresh token)
  and `METABOLISM_KEY_MANAGEMENT=observe`.
- Worker boot seeds the token store from `ORBIO_SESSION_SEED` when no store
  exists (`metabolism/session-seed.ts`). Never throws; a wrong
  `TOKEN_ENCRYPTION_KEY` is named by fingerprint.
- Lifecycle observe mode (`restrictToObserve`): reads and snapshots, never
  mints / rotates / revokes; adopts an operator key already live at the
  provider. In observe mode "we hold the secret" is checked against the key
  inference really uses (`ORBIO_API_KEY`).

### Fixed
- Commit loop re-committed batches whose receipt missed the 240s deadline even
  though the tx had mined. A timed-out tx is now resolved before any new batch.

### Decisions
Both recorded in `DECISIONS.md` (2026-09-15), including the reduced secret
separation from putting a session on Railway.

### Verify
- `pnpm verify` green.
- `pnpm railway:push-env --with-session --dry-run` refuses with "run `pnpm orbio:auth`"
  when the local session is dead; after a fresh `pnpm orbio:auth` it lists
  `ORBIO_SESSION_SEED  session seed for key <fp> (N chars)`.
- After a real push: worker log shows `[metabolism] session seed: wrote…` and
  `keys observe`; `curl -s "$API/v1/lifecycle?limit=1"` returns entries with a
  `balanceUsd`, and no `minted` / `revoked` reasons appear.
- After the worker redeploys with the commit fix: `launch_auditor_commit_age_seconds`
  stays under ~600, and a slow receipt logs `late receipt for … recording its
  batch` instead of a fresh batch with the same reports.

## 2026-09-15 (later) — commit outage: null receipts were cached

### Fixed
- `packages/rpc-budget`: a `null` answer to a hash-addressed read
  (`eth_getTransactionReceipt`, `eth_getTransactionByHash`, …) is no longer
  cached. This was the real cause of the "receipt not found within 240000ms"
  errors; the morning's hold-and-recheck fix amplified it (see DECISIONS.md).
- Commit loop: a held (unconfirmed) batch excludes its reports from the next
  batch instead of blocking it. Receipt-check errors are logged, not swallowed.

### Added
- `docs/review-pack/` — the independent-review pack (Phase A); the Codex Phase
  A output arrives as `CODEX-REVIEW-2026-09-15.md` once triaged.

### Verify
- `pnpm verify` green (rpc-budget 12 tests incl. the null-cache regression).
- After redeploy: `launch_auditor_commit_age_seconds` under ~600 and holding;
  `curl -s "$API/v1/launches?limit=200"` shows `proof.committed: true` on
  launches older than ~20 min within an hour of the deploy.

## 2026-09-15 (later) — outcome resolver no longer starves nine cells

### Fixed
- `apps/worker/src/outcomes/loop.ts`: deferred rows back off 30 min; transient
  failures give up to `UNRESOLVABLE` 24h after first deferral; the live loop
  shares its batch across outcome labels (`order: 'fair'`). Code-path failures
  back off too. See DECISIONS.md.
- SELL_IMPAIRED / DRAWDOWN_80 quote failures carry the raw RPC message
  (`evidence.rpcError`) into the deferral log.

### Added
- `/metrics`: `launch_auditor_outcomes_pending_due{label}`,
  `launch_auditor_outcomes_deferred{label}`, `launch_auditor_outcomes_resolved_24h{label}`.
- Codex Phase B review (verbatim) and the triage of both phases (DECISIONS.md).

### Verify
- `pnpm verify` green (worker `outcomes-loop.test.ts`, api metrics test).
- After deploy: `curl -s $API/metrics | grep outcomes_` shows every label; worker
  log sweeps show `resolved` counts well above 1 and `deferred (n)` lines with
  an rpcError; within ~24h `/v1/benchmark` lists more than two cells.

## 2026-09-15 (later still) — qualified-only outcome resolution, opt-in

### Added
- `OUTCOMES_QUALIFIED_ONLY` env var (default off, unchanged behavior). When on,
  the live loop resolves INSIDER_EXIT/SELL_IMPAIRED/LIQ_IMPAIRED for
  qualified-lane launches only; DRAWDOWN_80/TRADING_ALIVE stay universal. See
  DECISIONS.md for why (INSIDER_EXIT ~80 getLogs/resolution vs SELL_IMPAIRED's
  ~2, and ~87% of launches never qualify).

### Measured
- Raising `OUTCOMES_CONCURRENCY` 1→4 did not change the resolved-per-minute
  rate — confirms the shared RPC token bucket, not sweep latency, is the
  constraint.

### Verify
- `pnpm verify` green.
- Toggle on production: `railway variables --service worker --set OUTCOMES_QUALIFIED_ONLY=1`;
  worker log line changes to "...qualified-lane only for
  INSIDER_EXIT/SELL_IMPAIRED/LIQ_IMPAIRED"; `/metrics`
  `launch_auditor_outcomes_pending_due{label=...}` should stop growing for
  those three labels within an hour.

## 2026-09-15 (Cooper's session) — RPC budget raised, qualified-only turned on, key endpoint found

### Changed (Railway, ops only — no code)
- `RPC_BUDGET_RPM`: 500 -> 3000/min, after confirming Chainstack's real ceiling
  is 250/sec (~15,000/min), not the 250/min assumed earlier today.
- `OUTCOMES_QUALIFIED_ONLY`: 0 -> 1 (Cooper's call — see DECISIONS.md).

### Found
- `GET https://api.orbio.so/api/v1/key` with the bearer gateway key returns
  200 with balance/usage/rate-limit, no MCP session required (reported by
  another builder, confirmed against our own key). Not yet wired into the
  spend gate — see DECISIONS.md for why and what's still open.

### Verify
- `curl -s $API/metrics | grep outcomes_pending_due` — SELL_IMPAIRED/
  INSIDER_EXIT/LIQ_IMPAIRED should stop growing within an hour.
- worker log: `[outcomes] resolution loop ... qualified-lane only for
  INSIDER_EXIT/SELL_IMPAIRED/LIQ_IMPAIRED`.

## 2026-09-16 — Metabolism reads the gateway, not the MCP (slice 1 of the on-chain move)

### Found
- Production deep-dives were all failing: the key's account has $0 activated
  balance (402 `insufficient_quota`), surfaced by the SDK as "Response
  validation failed" and counted as skips.
- Orbio's protocol is on-chain (CREDIT token, `activate`, wallet-signed keys);
  the MCP is optional. Contracts verified on chain 4663 — see DECISIONS.md.

### Added
- `apps/worker/src/metabolism/gateway-reader.ts`: `GET {gateway}/key` ->
  balance, lifetime spend, key prefix. `METABOLISM_SOURCE` (default `gateway`).
- Lifecycle runner uses it; the gateway source is always observe mode.

### Verify
- `pnpm verify` green (`gateway-reader.test.ts`, recorded live fixture).
- After deploy: `curl -s "$API/v1/lifecycle?limit=3"` returns entries with a
  real `balanceUsd`; worker log `[metabolism] … source gateway · keys observe`
  and a `NO_KEY -> STARVED` transition while the balance is 0; deep-dive sweeps
  log `budget: balance is at or below the reserve` instead of validation failures.

## 2026-09-16 — wallet-signed Orbio key + autonomous CREDIT activation (slices 2+3)

### Added
- `apps/worker/src/metabolism/credit-wallet.ts`: key derivation from a wallet
  signature, `CREDIT.activate` with receipt + `Activated` decoding, on-chain
  daily activation total, pure `activationDecision`, and the call allowlist.
- Worker boot derives the key when `ORBIO_KEY_SOURCE=wallet`; the lifecycle
  runner activates CREDIT when `CREDIT_ACTIVATE=1`. Both default off.
- New env: `ORBIO_KEY_SOURCE`, `ORBIO_KEY_EPOCH`, `ORBIO_CREDIT_ADDRESS`,
  `ORBIO_STAKING_ADDRESS`, `CREDIT_ACTIVATE*`.

### Verify
- `pnpm verify` green (`credit-wallet.test.ts`: key format + signature recovery,
  allowlist refusals, activation decisions).
- After enabling on Railway with CREDIT in the gas wallet: worker log
  `gateway key from the gas wallet's signature: sk-orb-0-…` then
  `activated $5.00 CREDIT -> AI balance (activation #…, tx 0x…)`; the tx on
  Blockscout shows an `Activated` event from the gas wallet; within a few ticks
  `/v1/lifecycle` shows the balance and `STARVED -> ACTIVE`.

## 2026-09-16 — agent live on its own Orbio account; lag-aware epochs

### Measured
- Wallet-signature key authenticated; `STARVED -> ACTIVE` at $20.00 (operator
  activation #58 to the gas wallet); deep-dive sweep 5 scored / 0 skipped.

### Fixed
- `reconcileEpoch`: phantom needs zero requests in this and the previous window
  (`lagRequestCount`); windows under $0.02 on both sides are not graded.

### Verify
- `pnpm verify` green (`reconcile.test.ts` late-charge cases).
- `/v1/lifecycle` budget `spendableKeyUsd` = balance − 0.5.

## 2026-09-16 — dashboard: funding receipts, cost panel without hard-coded numbers

### Added
- `GET /v1/funding` (`apps/api/src/funding.ts`): every CREDIT `Activated` event
  whose beneficiary is the agent's account, split operator vs agent, with tx
  hashes. Incremental on-chain scan, cached for 60 s.
- Dashboard Funding card under Metabolism.

### Changed (de-claiming; reviewed in the wording pass)
- "P&L — trailing 24h" -> "Compute cost — trailing 24h". Both boxes now show
  derived numbers with their basis; the hard-coded `$0.00` revenue/cash rows and
  "paid entirely … never held or converted money" are gone (Codex #7).
- Continuity card: zero signed rows reads "no signed rows yet", not "chain
  verified: yes". The OAuth-refresh note is replaced (the key is a wallet
  signature now).
- Top metric shows the real AI balance and lifecycle state.

### Verify
- `curl -s $API/v1/funding` lists activation #58 (20 CREDIT, operator).
- Dashboard Metabolism panel shows AI balance, Funding card with the tx link.

## 2026-09-16 — lock the spending endpoints

### Changed
- `POST /v1/deepdive/:token` and MCP `request_deepdive` now require a valid
  `x-api-key` (401 / a JSON error otherwise). `/v1/assess` unchanged (free).

### Verify
- `pnpm verify` green (11 new/updated tests: refuse no-key, refuse wrong-key,
  accept valid key, for both HTTP and MCP).
- `curl -sI -X POST $API/v1/deepdive/0x...` -> 401 without a key; 202 with
  `-H "x-api-key: $DESIGN_PARTNER_API_KEYS"`.

## 2026-09-16 — fixed a 6.8h report-generation backlog; api RPC + alerts channel

### Fixed
- `startFeaturesWorker`: BullMQ concurrency was undocumented and defaulted to
  1 (unlike assess's explicit 2). `FEATURES_CONCURRENCY` (default 8) lets
  T+10m report generation run several launches in parallel.
- `apps/api` had no `RH_RPC_URL`; `GET /v1/funding` and `/v1/proof`'s on-chain
  confirmation were silently degraded. Set via Railway reference to worker's.

### Changed (ops, Railway)
- `TELEGRAM_ALERTS_CHANNEL_ID` set to the new private ops channel.

### Verify
- `curl -s $API/metrics | grep det_coverage_1to2h` climbs back toward 1 over
  the following ~30-60 min as the backlog clears; `det_report_lag_seconds`
  drops from ~24,500 toward the T+10m target (~600s).
- `curl -s $API/v1/funding` returns `configured:true` with activation #58.

## 2026-09-16 — property 2: daily deep-dive budget follows on-chain accrual

### Added
- `trailingCreditsUsd()` (credit-wallet.ts): Σ on-chain `Activated` events
  with the agent's wallet as beneficiary, rolling 24h window.
- `dynamicDailyCapUsd()` / updated `defaultLoadBudget` (deepdive/run.ts): calls
  the existing (previously dead) `dailyDeepdiveBudget()` with that figure;
  falls back to the flat `DEEPDIVE_DAILY_CAP_USD` if unconfigured or on error.

### Verify
- `pnpm verify` green (credit-wallet.test.ts: beneficiary is bytes32-padded,
  not address — the bug that would silently zero every accrual read).
- worker log on a skip: `budget: ... (24h credit accrual $X.XX, bound by
  credit_share|daily_cap|key_reserve)`.

### Consequence (see DECISIONS.md)
Without further funding, this cap trends toward $0 ~24h after the last
CREDIT activation into the agent's wallet, even with balance remaining.

## 2026-09-16 (same night) — dashboard budget display now matches the real gate

### Fixed
- `budgetDisplay` gained a `credit_share` candidate (optional `creditShareUsd`
  input) so the dashboard's daily cap tracks property 2 instead of showing a
  stale flat number once on-chain accrual becomes the binding constraint.
- `FundingSummary` gained `trailingCreditsUsd` (rolling 24h, reused from the
  already-cached scan `/v1/funding` does — no extra RPC read).

### Verify
- `pnpm verify` green (10 new tests: rolling-window edge at exactly 24h,
  credit_share binding/non-binding/zero cases).
- `curl -s $API/v1/lifecycle?limit=1` — `budget.creditShareUsd` present and
  non-undefined once `ORBIO_AGENT_ACCOUNT`/`ORBIO_CREDIT_ADDRESS` are set.

## 2026-09-16 (same night) — keep-warm: property 2 can no longer deadlock

### Fixed
- `activationDecision` (credit-wallet.ts) gains a time-based trigger:
  activate even on a healthy balance once `CREDIT_ACTIVATE_KEEP_WARM_HOURS`
  (default 20) has passed since the agent's last self-activation. Without
  this, once the trailing-24h accrual window went cold the whole daily
  budget latched at $0 with no way back — balance stops moving once spend
  stops, so the old low-balance trigger could never fire again either.
- Sourced from the local lifecycle log (Postgres), not an on-chain scan —
  an earlier draft of this fix scanned 30 days of Activated events every 60s
  tick, which would have reintroduced exactly the RPC contention fixed
  earlier tonight. Caught before it shipped.

### Verify
- `pnpm verify` green (8 new tests: fires despite healthy balance, respects
  the daily cap and the pending guard, custom window, no-CREDIT refusal).
- worker log on a keep-warm fire: `[metabolism] activated $X.XX CREDIT ->
  AI balance ... — keep-warm: ...h since last activation >= 20h`.

## 2026-09-16 (later still) — wording pass applied; style guide added

### Changed (public copy, Cooper approved all 10 items)
- README.md / spec: "four" -> "five outcomes, eleven cells"; property 2
  rewritten to describe the live on-chain CREDIT mechanism instead of the
  old unbuilt claim; property 3 rewritten (wallet-signed key never expires,
  vs. the old "keys drain, rotate" language); "one-time browser sign-in —
  the ONLY interactive step, ever" corrected to "no browser, no session,
  ever"; fork-and-run's "no top-up" clarified to "no top-up from a fiat
  rail" with a pointer to the dashboard's Funding disclosure.
- Dashboard benchmark panel: added what "beats X" does and doesn't mean
  (DeLong-significant ranking, not calibration).
- Full before/after table in DECISIONS.md.

### Added
- `docs/STYLE-GUIDE-2026-09-16.md`: visual identity from the dashboard's
  existing tokens, the accent-color inconsistency flagged (not fixed),
  a tailored video-explainer prompt.

### Verify
- `git diff 9339f17 d59b531 -- README.md launch-auditor-spec-v0.2.md apps/web/public/index.html`

## 2026-09-17 — det_v0.1: four cells promoted, wired for parallel scoring; SELL_IMPAIRED held

### Added
- `packages/scoring/weights/det_v0_1.json`: `LIQ_IMPAIRED@24h`, `DRAWDOWN_80@24h`,
  `TRADING_ALIVE@24h` `biasOverride` updated to the 2026-09-09 re-featured
  backfill's rates (n grew 144/102/79 -> 194/131/204). `INSIDER_EXIT@6h/@24h`
  unchanged (that backfill excluded INSIDER_EXIT). `SELL_IMPAIRED@1h/@24h`
  deliberately NOT added despite being newly measurable (~96%, n~50) — see
  DECISIONS.md.
- `apps/worker/src/report/assemble.ts`: `det_v0.1` now built and persisted
  alongside `det_v0`/`heuristic_v1` for every launch report — it accumulates
  its own live Brier Skill Score without touching what's posted to the public
  feed (`telegram/poster.ts` is unchanged, still `det_v0` only).
- `packages/db/prisma/schema.prisma` + migration
  `20260917042039_m10_det_v0_1_forecaster_kind`: `ForecasterKind` enum gains
  `det_v0_1 @map("det_v0.1")` (Postgres enum values can't contain a literal
  dot). Applied automatically on the next worker deploy — `prisma migrate
  deploy` already runs in the worker's start command, no manual DB step
  needed.

### Fixed
- `packages/scoring/test/det-v01.test.ts`: `TRADING_ALIVE@24h` bias assertion
  updated `-1.016` -> `-0.972` to match the new intercept.

### Verify
- `pnpm verify` green (48 files / 381 tests, prisma schema valid, typecheck
  clean).
- After deploy: `curl -s $API/v1/benchmark` should show a `det_v0.1` row
  starting to accumulate `n` once T+10m reports and their outcomes resolve.

## 2026-09-17 (same night) — incident: the det_v0.1 deploy above broke report writes for ~6 minutes

### What happened
`@map("det_v0.1")` on the new `ForecasterKind` enum value made Prisma Client
reject every det_v0.1 write client-side (`Invalid value for argument
'forecaster'. Expected ForecasterKind.`) — Prisma validates enum arguments
against the schema identifier (`det_v0_1`), not the `@map`-ped DB value.
`apps/worker/src/watcher/t10.ts` catches and logs per-launch rather than
crashing, so the watcher/outcomes/telegram/commit loops all kept running
normally throughout — this was silent unless you were tailing worker logs.

**Confirmed impact** (via `railway logs --service worker --deployment`, full
window from deploy to fix): exactly 20 launches hit the error, one time each.
For each: `heuristic_v1` and `det_v0` reports persisted fine (upserted before
the loop reached `det_v0.1` and threw) — no data lost there. `det_v0.1`'s own
report row, and `ensureOutcomeRows` (called once after the loop, for all
three drafts together, never reached) were both skipped. Nothing else was
affected — no crash-loop, no impact on unrelated launches.

Affected `launchId`s (for the eventual backfill — re-run
`buildLaunchReports(client, launchId, 'launch')` +
`persistLaunchReports(drafts)` for each; same deterministic block pin as the
original attempt, so the existing `det_v0`/`heuristic_v1` rows upsert as a
no-op and only the missing `det_v0.1` row + outcome-grid rows get created):

```
cmu50phmu03zcql2ashz2ofbu  cmu50phti03zeql2auyhjr1av  cmu50prcw03zjql2adr5o7yev
cmu50py2o03znql2a3fyqrypa  cmu50q7mg040oql2acuzch06g  cmu50q7qr040qql2au4d9aw9t
cmu50r9kj041nql2a3rjy84va  cmu50sif70447ql2awusb4lv9  cmu50t1bm044iql2ahxdtwxd8
cmu50t4kf044lql2atq50mrnb  cmu50t7ti044oql2as5fb68v2  cmu50tb3y0457ql2aholvuyvs
cmu50thhc045bql2athc0k97n  cmu50u0ff046fql2atz2i85ed  cmu50u0jh046hql2aguo39m0s
cmu50u0my046jql2azsufv5fw  cmu50u3t8046mql2ase7opdtn  cmu50u3vl046oql2adiojwlxv
cmu50umsg0492ql2acheqllh7  cmu50uq0g0495ql2a60dn9sv4
```

Not scripted against production unreviewed right before a long gap — left as
a bounded, documented follow-up (20 launches, no data loss, nothing time
-sensitive breaks by waiting).

### Fixed
- `74d0be2` — see the entry above for the actual fix (rename the enum value,
  fix `assemble.ts` to use `det_v0_1`).

### Verify
- `railway logs --service worker --deployment` — 0 occurrences of "Invalid
  value for argument" since `74d0be2` deployed (confirmed over a 200-line /
  ~45s window post-deploy).
- `curl -s $API/metrics` — `det_coverage_1to2h: 1`, `watcher_staleness: ~3.6s`,
  `commit_age: ~270s` — all nominal, no cascading damage.

## 2026-09-17 — per-catch-site failure counters on /metrics (M10)

The systemic fix for silently-swallowed errors — the same bug class as the
2-day pool-derivation stall, the 6.8h report backlog, and the det_v0.1 enum
incident two entries up: a `catch` block in a long-running loop logs and
keeps going (correct — one bad launch/token shouldn't stop the sweep), but a
console line nobody is tailing is invisible until someone goes looking.

### Added
- `packages/db/prisma/schema.prisma` + migration
  `20260917074722_m10_catch_site_failures`: `CatchSiteFailure` table (`site`
  primary key, `count`, `lastMessage`, `lastAt`) — same "Postgres is the
  transport between api/worker" reasoning as `BenchmarkSnapshot`.
- `apps/worker/src/failures.ts`: `recordFailure(site, err)` — upserts the
  counter, fails safe (a DB hiccup recording a failure never masks or throws
  over the original error), and no-ops under `process.env.VITEST` so `pnpm
  verify` stays fully offline (a real Prisma call against an unreachable
  `localhost:5432` took ~4s to fail per test that hit it — measured on
  `telegram-poster.test.ts` before adding the guard).
- Wired into the 15 catch sites across the worker's long-running loops that
  were logging-and-continuing with nothing on `/metrics`: `watcher.
  pool_abandoned` / `ingest_error` / `poll_error`, `t10.primary_pool_check` /
  `report_assembly`, `outcomes.resolve_failed` / `sweep_error`, `metabolism.
  revoke_key_failed` / `tick_error`, `telegram.post_failed` / `sweep_error`,
  `commit.loop_error`, `deepdive.run_failed` / `sweep_error`, `scorer.
  snapshot_failed`. Deliberately left out routine retry/deferred bookkeeping
  that already has its own visibility (e.g. `outcomes` deferred counts are
  already a `/metrics` series) — the goal is unexpected failures, not
  expected retry churn re-counted as if it were one.
- `apps/api/src/metrics.ts`: `launch_auditor_catch_site_failures_total{site}`
  (counter) and `launch_auditor_catch_site_failure_age_seconds{site}` (gauge,
  `NaN` semantics match every other unavailable gauge here) — only emitted
  when at least one site has ever failed.

### Verify
- `pnpm verify` green.
- `curl -s $API/metrics | grep catch_site` — empty until something actually
  fails (nothing has, post-incident); the det_v0.1 gap-repair script (next
  section) is a convenient way to exercise it if you want to see it populate.

## M11a — `base_rate_fixed` climatology baseline + overlap n on comparisons (2026-09-17)

Pre-judging checklist item 6, part 1 (Codex Phase B #3 / #8 in DECISIONS.md).
Split from part 2 (`GET /v1/launch/:token` — M11b) to stay under the ~200-line
guideline.

### Added
- `packages/scoring`: `scoreBenchmark`'s default DeLong baselines gain
  `base_rate_fixed`; `Comparison` gains `n` (the paired-overlap sample size —
  can be smaller than either forecaster's own `n`, and was previously only
  implicit in `y.length` inside `cell()`, never published).
- `apps/worker/src/scorer/collect.ts`: emits a `base_rate_fixed` `ScoreRow`
  alongside every `base_rate` row — whole-sample prevalence per (outcome,
  horizon) cell, computed once, same probability for every observation. The
  existing `base_rate` is a same-stream, time-varying predictor (Codex Phase B
  measured its live AUROC at ~0.37/0.42, not the ~0.5 a constant predictor
  should score); `base_rate_fixed` is the honest floor a claim should really
  be checked against.
- `packages/db`: `ForecasterKind` gains `base_rate_fixed` (migration
  `20260917090000_m11a_base_rate_fixed`) — documentation-only, like the
  existing `base_rate`/`scanhood`/`goplus` entries; never written to
  `reports.forecaster`, so no data migration.
- `launch-auditor-spec-v0.2.md` §2 and README's dashboard-benchmark bullet
  updated to describe both.

### Verify
- `pnpm verify` green (packages/scoring: 9 scorer tests incl. `n=0` on a
  disjoint-overlap comparison, AUROC ≈ 0.5 for a constant predictor against a
  mixed-label cell, and `base_rate_fixed` appearing as a default baseline;
  packages/db schema test updated).
- After deploy: `curl -s $API/v1/benchmark | jq '.all.sections[0].byOutcome["DRAWDOWN_80@24h"][] | select(.forecaster=="base_rate_fixed")'`
  should appear once the next 5-minute snapshot runs, with `auroc` near 0.5;
  every comparison entry (`.comparisons[]`) now carries `n`.

### Not done (M11b, same checklist item)
`GET /v1/launch/:token` — primary-pool evidence, feature vector + provenance,
outcome rows, so the benchmark can be reproduced from public API data alone
(Codex Phase A #2 / Phase B #2).

## M11b — `GET /v1/launch/:token` detail endpoint (2026-09-17)

Pre-judging checklist item 6, part 2. Codex Phase A #2 / Phase B #2: "the
public API cannot reproduce the benchmark" — `/v1/report` has forecasts,
`/v1/benchmark` has the scored table, but nothing public had primary-pool
selection, the raw feature vector, or outcome evidence.

### Added
- `apps/api/src/launch-detail.ts` — `prismaLaunchDetailReader(token)`: one
  `Launch` row (with `feature` + `outcomes` included), reshaped for the wire —
  `launchBlock` (bigint) stringified, `Date`s to ISO, the full `Feature`
  vector minus `id`/`launchId` (so a new feature column is exposed
  automatically, not hand-listed), every `Outcome` row sorted `(label,
  horizon)`. Read-only, no auth (same free tier as `/v1/report`).
- `GET /v1/launch/:token` (`apps/api/src/server.ts`): same 400/404 shape as
  `/v1/report/:token`; `launchDetailReader` injectable for tests.
- README endpoint table row.

### Verify
- `pnpm verify` green (`apps/api/test/launch-detail.test.ts`: serves the
  injected row, 404 with no launch, 400 on a malformed token, `feature: null`
  before T+10m/`outcomes: []` before anything resolves).
- After deploy: `curl -s $API/v1/launch/<a token from /v1/launches>` returns
  `primaryPool`, `feature`, and `outcomes[]` matching what `/v1/benchmark`'s
  cells for that token were built from.


## 2026-09-18 — outage: Chainstack monthly RU quota exhausted (~13h); budget lowered

### What happened
From ~09:37Z every RPC call returned "You've reached your monthly quota of
Request Units". Watcher, commits, outcome resolution and deep-dives all
stopped (`watcher_staleness_seconds` reached 46,105). The M10 per-catch-site
counters showed it (`watcher.poll_error`, `commit.loop_error`,
`outcomes.resolve_failed`, `metabolism.tick_error` all firing), and the alert
loop worked: "watcher stalled" and "commit lag" were posted to the private ops
channel at ~09:44Z / 09:47Z, within minutes of the outage starting. They
arrived at 2:44 AM local and nobody saw them until ~13h later, while M11 was
being deployed. Both "recovered" messages arrived at ~23:20Z after the quota
upgrade. Cause: `RPC_BUDGET_RPM`
was raised 500 → 3000 on 09-15 without checking the monthly quota
(DECISIONS.md flagged that at the time). With ~200k PENDING outcomes the
worker saturates whatever ceiling it's given, so 3000/min used up 20M RU in
about 3 days.

### Changed (ops, no code)
- Chainstack plan upgraded 20M → 80M RU/month (Cooper).
- `RPC_BUDGET_RPM` on worker 3000 → **1000**: ~1.4M requests/day, about a
  month of headroom on the remaining quota. The scheduler still serves
  watcher and commits first, so the live feed isn't slowed; only the outcome
  backlog drains more slowly.

### Verify
- `curl -s $API/metrics | grep -E 'watcher_staleness|commit_age'` both under
  ~60s; the feed's newest `launchAt` is minutes old, not hours.
- Check RU burn in the Chainstack console after 24h: at ~2M RU/day the plan
  lasts the cycle.

### Open
- The alert loop's "already alerted" state is in memory, so the M11 redeploy
  in the middle of the outage re-sent both alerts (769/771min). Every restart
  during an incident will re-alert. Minor, but it's noise.
- An alert at 2:44 AM with nobody on call waits until morning. For an
  overnight stall, the budget cut is what limits the damage now.

## M12b — the public feed posts rank tiers, not probabilities (2026-09-19)

Fable's decision A (19 Sep). The benchmark supports two things about
`det_v0`: it beats both base rates at *ranking* insider exit (24h) and still
trading (24h), and its probabilities are miscalibrated on every cell (negative
Brier Skill). The feed was posting rounded probabilities ("100% / 100% / 0%")
on three cells, including drawdown, where `det_v0` ranks backwards.

### Changed — `apps/worker/src/telegram/poster.ts`
- Two rows only: insider exit within 24h and still trading at 24h, each as a
  rank tier (top 10% / top 25% / middle half / bottom 25%) against `det_v0`
  scores of qualified launches anchored in the 24h before this one (ties count
  half). Fewer than 20 peers → "not ranked". Drawdown is no longer posted.
- Footer: "Ranking only: these scores are not calibrated probabilities",
  linking `/v1/benchmark` when `PUBLIC_API_BASE_URL` is set.
- A report whose batch committed more than 30 minutes after its T+10m anchor
  is never posted. During the 18 Sep outage, catch-up reports built hours late
  were going out as "New qualified launch". Candidates are limited to reports
  anchored in the last hour, so skipped ones age out instead of blocking the
  queue.
- "committed before outcome" → "Committed N min after its T+10m anchor", the
  measured lag, which anyone can check against the batch tx.
- README: the "never double-posts" wording (Codex §3.7) corrected to
  best-effort deduplication.

### Verify
- `pnpm verify` green (`telegram-poster.test.ts`: 15 tests — tier buckets,
  ties, the peer minimum, no probability or drawdown text, freshness boundary
  at 30 min, stale rows not consuming the per-sweep limit).
- After deploy, the next post in the public channel has two tier rows, the
  footer, and a commit lag under 30 min. Worker log lines read
  `[telegram] swept N: … posted · … stale · … failed`.
- Not yet checked against live data: how spread out `det_v0` scores are among
  qualified launches. If most tie, most posts land in "middle half". Check
  this in the tunnel session alongside M12a.

## Tier 1 (19 Sep audit) — timing eligibility, claim gates, one cohort (2026-09-19)

Release blocker from `docs/INDEPENDENT-AUDIT-2026-09-19.md`. `reportTime` is
the T+10m *block* time, not when a report was issued, so reports built late
(18 Sep outage replays, the 16 Sep 6.8h backlog) carry anchors from before
they existed. The audit found one committed 11h36m45s after its anchor, after
its 1h and 6h horizons had ended, and the scorer counted such rows like any
other. The M12c benchmark/dashboard work is included here, since it touches the same code.

### Changed — scorer
- `apps/worker/src/scorer/eligibility.ts` (new): each report-outcome pair is
  classified by its commit's **chain block time**, never the DB's `committedAt`:
  - `eligible` — committed ≤ 30 min after the anchor and before the horizon ended;
  - `replay` — committed later, horizon still open;
  - `late` — committed at or after the horizon end;
  - `uncommitted`, `missing_time`.

  Signed reports are untouched; "replay" is a scoring-time class, not a
  rewritten trigger.
- `collect.ts`: only eligible pairs are scored. Base rates, ScanHood and GoPlus
  inherit `det_v0`'s class for the same observation, so a cell compares
  forecasters on the same rows. Scanner rows also need their fetch within
  30 min of the anchor, since a late ScanHood fetch sees post-launch liquidity.
  Every pair is counted in `benchmark.exclusions[outcome][forecaster][class]`.
  Block times come from a cached, budgeted `getBlock`, prefetched in parallel;
  no schema change. The scanner anchor is now the launch's *earliest*
  launch/qualified report. It used to be whichever report came last in
  unordered iteration, the likely cause of the audit's live > all anomaly.
- `packages/scoring` gates:
  - the ≥30-positives check counts the *paired* rows (`Comparison.positives`);
  - below n=100 every metric and comparison is withheld, not just badged;
  - no "beats X" when the forecaster's own AUROC is ≤ 0.5;
  - `invertedRanking` flags AUROC significantly below 0.5 (Hanley–McNeil,
    z > 1.96) on claim-sized samples.
- Snapshot gains `coverage` (graded / pending / unresolvable / n/a /
  retrospective per cell, from the rows' own flags) and a `resolutionPolicy`
  line.

### Changed — dashboard
- One cohort: the `live` section, eligible rows only. The `+N retro` badge
  (inferred as `all.n − live.n`) is gone. Backfill is counted from rows and
  noted, never inferred.
- Under each outcome: graded/pending counts, "excluded from claims" by class,
  and backfill if any. The "ranks backwards" badge links DECISIONS.md.
  Resolution policy is shown under the table. The callout states the
  eligibility rule instead of "only live, precommitted forecasts".
- Funding card: the activate-only allowlist, described as the worker's code
  path, not as a wallet restriction.

### Verify
- `pnpm verify` green (worker 404, scoring 59):
  - `eligibility.test.ts` uses the audit's replay token
    `0xafb2…e458`: late on 1h/6h, replay on 24h/72h/7d, and its timely
    samples eligible;
  - `collect-eligibility.test.ts` runs the collector over those fixtures
    against a stubbed DB;
  - the scorer tests reproduce the audit's paired-positives counterexample and
    the inverted-comparator badge.
- After deploy (logged out): `curl -s $API/v1/benchmark | jq .live.exclusions`
  has counts per class. That is the census; record it in DECISIONS.md.
  `LIQ_IMPAIRED@24h` `det_v0` has no `claimAllowed` comparison. The LLM
  SELL_IMPAIRED@24h cell (n<100) shows `auroc: null`.

## Tier 2 (19 Sep audit, fix 3) — a receipt for every forecast, verifiable offline (2026-09-19)

`/v1/proof` showed a hash was in a committed batch; it didn't show that the
displayed forecast produced that hash. The audit's DEMO step 3 also failed:
the proof cell linked the batch transaction, which many reports share.

### Added
- `GET /v1/receipt/:hash` (`apps/api/src/receipt.ts`) returns:
  - the exact canonical bytes that were hashed;
  - the EIP-712 domain, types and message, plus the signature and signer;
  - the Merkle proof and root;
  - the commit's **chain** block time, read by `getBlock` and cached, never
    the DB's receipt-recording time;
  - the lag from the anchor;
  - every outcome for the same anchor, with its eligibility class.
- `pnpm verify:receipt <hash> [--rpc URL] [--api URL | --file receipt.json]`
  (`apps/api/scripts/verify-receipt.ts`, checks in `src/verify-receipt.ts`)
  recomputes keccak256(bytes) and recovers the signer from a message rebuilt
  from the **bytes' own fields**, not the receipt's `eip712.message`. It folds
  the Merkle proof, finds the root in the registry's `BatchCommitted` event at
  that block via any RPC (default: public ordofi), reads the block timestamp,
  and re-derives each outcome's eligibility from it. No DB, no operator
  credentials.
- The eligibility rule moved to `packages/scoring` (`eligibility.ts`) so the
  scorer and the receipt classify identically; the API now depends on it.

### Changed
- Dashboard proof cell: "receipt ↗" (with the verify command in its tooltip)
  first, the shared "batch tx ↗" second.
- Live launches table: the two cells `det_v0` ranks well on, shown as 0–1
  **scores** labelled "ranking only". No percentages, and the drawdown column
  is removed, matching the feed (decision A).
- Scorer block-time reads: in-flight promise cache (the concurrent `both` and
  `live` passes were each fetching every block) and commit priority. At
  outcomes priority, the post-outage T+10m backlog at watcher priority starved
  them, and the first Tier 1 snapshot didn't finish in 20 min.

### Verify
- `pnpm verify` green (`apps/api/test/receipt.test.ts`, 10 tests: a genuine
  signed receipt passes; edited bytes fail hash and signature; a doctored
  `eip712.message` changes nothing; a wrong signer fails; a bad proof fails;
  eligibility is re-derived from chain time over a lying server label; the
  route returns 400/404/200).
- After deploy, logged out:
  `pnpm verify:receipt <a committed det_v0 reportHash>` prints PASS for hash,
  signature, merkle, on-chain root and block time.

### Tier 2 follow-up — observed on production (2026-09-19)
- `verify:receipt` now reads the commit's **tx receipt** and decodes
  `BatchCommitted` from it, instead of calling `eth_getLogs`. The public RPC
  rejected every `getLogs` attempt ("network is busy"), so a judge's run would
  have failed. Reading the receipt also ties the root to that exact tx. The tx
  must have succeeded and been mined in the claimed block. Retries back off
  exponentially, up to 10 attempts.
- Feed: "Verify this forecast" now links `/v1/receipt/<hash>`.
  `PUBLIC_API_BASE_URL` is set on the worker, so posts carry it and the
  benchmark link.
- **Evidence, logged out, deployed `101781b`, public RPC:**
  - `pnpm verify:receipt 0xd58bb77b…ffa5` (feed post, 08:41Z): all six checks
    PASS. Signer `0x6a5A…B4BE`; committed 304 s after the anchor; 11/11
    outcomes eligible.
  - `pnpm verify:receipt 0xdf34beac…178a` (the audit's replay token): integrity
    PASS; committed 41,805 s after the anchor; 1h/6h `late`, the rest `replay`.
- M12b feed format observed on production (`a2603e7`): 20/20 visible posts use
  rank tiers, ranked against 813 peers, commit lag 0–6 min, tiers spread
  across all four buckets.

## Tier 2 (19 Sep audit, fixes 4 + 6) — a pinned verified example; one budget calculation (2026-09-19)

### Added — dashboard panel 00, "One forecast, checked end to end"
- Fetches `/v1/receipt/<hash>` for feed post 884 (`0xbe1e685a…c7e915`,
  15 Sep): the token, the T+10m anchor, the commit's chain block time
  (330 s later, with the tx), the signer, and the four headline outcomes with
  score / what happened / eligibility. An insider exit happened, and `det_v0`
  scored it 0.996.
- It was picked from the 113 completed, fully eligible forecasts found by
  scanning 614 public feed posts from 12–16 Sep, because it resolved the cell
  `det_v0` is best at. The panel says it's an illustration, not evidence:
  most launches score above 0.99, and the benchmark (04) is the evidence.
  Scanning 400 posts from 17–18 Sep found **none** with any resolved outcome;
  the resolver works through its backlog oldest first.
- Shows the `pnpm verify:receipt` command and the raw receipt.

### Changed — the budget display runs the worker's gate
- `dailyDeepdiveBudget` and `deepdiveRunGate` moved verbatim to
  `packages/db/src/deepdive-budget.ts`. The worker re-exports them (imports
  unchanged) and the API's `budgetDisplay` now calls them. There is no
  hand-kept copy to drift from.
- Same spend window as the worker: `max(Σ ledger, Σ provider epochs)` since
  00:00 UTC (new injectable `todaySpendReader`), not the trailing 24h.
- The display shows the configured ceiling, today's effective cap
  (`min(ceiling, ½ trailing CREDIT, spendable)`) and what binds it, spend since
  midnight UTC, remaining, next-run max, the gate's own reason when it's
  closed, `balanceUnknown`, and `capSource`: `credit_linked`, or
  `flat_fallback` when CREDIT can't be read (disclosed, as the worker falls
  back the same way).
- The display's doc comment no longer says the agent "never holds or converts
  money". Its wallet holds CREDIT.

### Verify
- `pnpm verify` green (api 74). `budget-display.test.ts` covers the audit
  counterexample: $5 ceiling, 2 CREDIT → $1 share, $25.42 balance, $0.90
  spent → effective cap $1, remaining $0.10, next run $0.10. It also checks
  that result against a direct run of the worker functions.
- After deploy, logged out: panel 00 renders the receipt, and the budget card
  shows "today's effective cap" with its binding term.

## Tier 3 (19 Sep audit, fix 7) — copy matches what production shows (2026-09-19)

Removed or qualified the absolutes the audit listed:
- **Dashboard hero:** no longer "every new token launch" or "exact
  probabilities". It says scores rank launches and are not calibrated. The
  tagline says "forecasts", not "oracle".
- **README intro:** claims are now the eligibility rule, the receipt command
  and "not calibrated". The earlier "every dollar of compute it has ever spent
  came from CREDIT activations" was untrue before 16 Sep; it now says "since
  16 Sep".
- **200-word summary:** rewritten (198 words). It carries the 22% census, the
  two surviving wins, the inverted cells, the scanner doing better, and the LLM
  null result. "Authorize once" and "never holds or converts money" are gone.
- **Fork-and-run:** "authorize once" → point it at a wallet holding CREDIT.
- **Spec §0/§0.1:** "Oracle" → "Forecasts"; "within seconds"/"every forecast"
  → the T+10m anchor and eligibility rule; "authorizes the MCP" → a wallet
  holding CREDIT. "nothing expires … the only human action possible" now names
  what the agent still depends on (RPC, funding, gas, the operator-held key).

## 2026-09-19 — lifecycle chain forked during deploys; now serialized, and forks told apart from breaks

### Found (logged-out walkthrough at `2c4ccd6`)
The Key lifecycle panel read "chain BROKEN at 232 · genesis no". Rows 230
(02:47:34Z) and 231 (02:48:11Z) both name row 229 as their parent: during the
Tier 1 deploy the old and new worker containers each appended from their own
in-memory head. Row 470 is the same thing at a later deploy. Every row still
hashes and every parent exists, so nothing was altered, but the chain is a
tree, not a line. The same window also shows **no lifecycle rows from 02:48Z
to 04:51Z**. The runner didn't tick for about 2h, most likely the same RPC
starvation that held up the scorer that night. Not yet confirmed.

### Fixed
- Writer (`lifecycle-runner.ts`): `prismaPersist` appends inside a transaction
  holding a Postgres advisory lock and checks the row's `prevHash` against the
  real head. On a mismatch it throws `HeadMovedError`, and the writer chains
  onto the real head, re-signs, and retries once. Two containers now
  interleave instead of forking.
- Verifier (`packages/db/lifecycle-chain.ts`): a row whose parent is an intact
  earlier row is a **fork**, listed in `forks[]`. A row that doesn't hash, or
  names a missing parent, is still `brokenAt`. `/v1/lifecycle` returns
  `verified` = intact (no row altered, no missing parent), `linear` and
  `forks`.
- Dashboard: "rows unaltered: intact, 2 forks" with the deploy-overlap
  explanation; "newest 500 rows, not from genesis" instead of a bare "genesis
  no"; and "longest gap between rows", so the 2h silence shows.
- Funding note: "can only become its own AI balance" → the worker's code path
  only activates; an application check, not a wallet restriction (Fable).
- Live launches note: the newest rows are always pending (scores at T+10m,
  commit a few minutes later).

### Verify
- `pnpm verify` green. `lifecycle-runner.test.ts` covers a fork → intact with
  forks [2, 3]; a deleted row → still broken; a writer re-chaining after
  `HeadMovedError`.
- After deploy: the Key lifecycle panel reads "intact, 2 forks". The forks
  shouldn't increase across the next deploy (if both containers overlap, rows
  interleave).

## 2026-09-19 — Tier 3 close-out: DEMO.md, current CLAIMS.md, last copy fixes

- `DEMO.md` rewritten against `0df3f67`, walked through logged out at ~09:30Z.
  It follows the audit's recommended order: one verified forecast first (panel
  00 + `verify:receipt`), then the eligible record with its failures (census,
  two surviving wins, three inverted cells, the scanner doing better, the LLM
  null result, selection bias), then what Orbio funded, then what broke.
- `docs/CLAIMS.md` (new): every current public claim, quoted, with its evidence
  type (prod-observed / verified-offline / source-only). The fork-and-run claim
  is marked **not demonstrated** while the repo is private.
  `docs/review-pack/CLAIMS.md` is marked superseded and kept as the dated
  record Codex tested.
- Dashboard footer: "Committed before outcome" → "Counted forecasts were
  committed before their outcome window closed", plus "scores rank". The Key
  lifecycle subtitle now reads "each row folds its parent's; forks are shown".

## 2026-09-19 — auditor follow-up: corpus pagination, registry on the API, backlog up front

### Changed
- `GET /v1/launches` is paged: an opaque `nextCursor` (base64url of
  `launchBlock:launchId`), followed via `?before=` until it's null. The feed is
  ordered newest first by `(launchBlock, id)`, not `launchAt`, which can be
  null. Rows carry `launchBlock` and `launchId`. A malformed cursor → 400.
  The test walks a 30-launch corpus in pages of 4 with three-way ties inside
  each block, and gets every launch exactly once.
- API deployment: `COMMIT_REGISTRY_ADDRESS` is now set (a Railway reference to
  the worker's value). Receipts carried `"registry": null`, and
  `/v1/proof`'s on-chain confirmation had been skipped since M9 — the audit saw
  `onChainConfirmed: null` on every proof. One variable, both fixed.
- Benchmark panel headline: "Graded so far: X of Y outcomes whose horizon has
  passed", computed from the snapshot's own coverage (currently 17,407 of
  267,069, 6.5%).
- `DEMO.md` has a section on the main operational risk: 239,609 due and
  ungraded, 640 graded in the last 24h, 11,760 recorded failures and what they
  were.

### Verify
- `pnpm verify` green (api 76).
- After deploy, logged out:
  - `curl -s "$API/v1/launches?limit=2"` has `nextCursor`, and following it
    returns the next two;
  - `curl -s $API/v1/receipt/<hash> | jq .commit.registry` is the registry
    address;
  - `/v1/proof/<hash>` has `onChainConfirmed: true`.

## 2026-09-19 — public source repository; dashboard links point to it

- The owner published **github.com/cavemancoop/tripwire-launch-auditor-public**:
  one clean commit (`257c5c5`, GitHub no-reply author), without this repo's
  history, audits, review packs or commercial document.
- Checked anonymously:
  - HTTP 200, MIT licence;
  - `apps/`, `packages/` and `scripts/` byte-identical by git blob hash to the
    private `main` (`6f728a2`);
  - no credentials;
  - a fresh clone, `pnpm install` and `pnpm verify:receipt 0xbe1e685a…`
    pass all six checks.
- The dashboard's "ranks backwards" badge linked `DECISIONS.md` in this
  **private** repo, which returns 404 for judges. It now links the public
  README's "What the benchmark says", and its tooltip carries the hypothesis
  itself.
- `docs/CLAIMS.md` C7, audit-response finding 2 and DEMO.md now point at the
  public repo. The history rewrite to remove the docx from *this* repo is
  dropped: this repo stays private, and no commit hashes change.

## 2026-09-19 — production database password rotated; public repo synced

- **Password.** The Postgres password had appeared in an operator chat. It was
  changed inside Postgres (`ALTER USER`, now a fresh SCRAM hash) through the SSH
  tunnel, and set on the Postgres service's `POSTGRES_PASSWORD` via
  `--stdin`. `PGPASSWORD` and every service's `DATABASE_URL` are Railway
  references and picked it up. api, worker and web were redeployed at 11:00Z.
  The value was generated locally, never printed, and deleted afterwards.
- **Checked:**
  - after the redeploy the worker wrote new lifecycle rows and ingested new
    launches;
  - the API served DB-backed data;
  - there were no authentication errors in either service's logs;
  - the lifecycle log stayed intact across the triple redeploy (no new fork).
- **Note:** Postgres's `pg_hba` trusts local (127.0.0.1) connections, which
  include Railway's SSH tunnel. Tunnel access is gated by the Railway login and
  a registered SSH key, not the DB password. Network clients need the password
  (`scram-sha-256`). There's no public TCP proxy.
- **Public repo:** `fb530d1` mirrors the dashboard badge fix, so its code is
  again identical (by blob hash) to the deployed `5ac8e8f`.

## 2026-09-19 — dashboard presentation pass before judging

- Panel 01 subtitle: "zero-billing compute, credit-driven throughput,
  unattended continuity" → "CREDIT-bounded compute, public funding records, and
  a signed continuity log". The old phrase overstated what the public README
  claims.
- The API base URL input and reload button are now behind a subtle "Advanced"
  disclosure. The status dot stays visible, and the default still comes from
  `config.json`.
- Live launches: `raw` → "on-chain detected", `unknown` → "unattributed",
  `index` → "early lane" (with tooltips). Launchpad names are unchanged.
- Lifecycle rows: "key age ?d" → "key age unavailable". New rows are written
  that way by the worker. Older signed rows are relabelled on display only;
  `/v1/lifecycle` still serves the exact signed text.
- Verified locally against the production API; `pnpm verify` green. Mirrored
  to the public repo so its code again matches the deployed tree.
