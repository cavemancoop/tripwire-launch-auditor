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
