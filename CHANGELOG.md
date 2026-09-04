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
