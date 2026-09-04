# Launch Auditor

Precommitted exit-risk oracle for Robinhood Chain (chain 4663). For every new token
launch it computes deterministic manipulation / exit-risk features within seconds,
publishes probabilities for four mechanically-defined outcomes, signs and commits the
forecast on-chain **before** the outcome can be known, and later grades every forecast
with an open-source scorer against those outcomes and against public baselines.

What it claims: the forecast existed before the outcome; the scorer is reproducible;
the baseline comparison is public. What it does **not** claim: that it pays for itself,
that no human touched the server, or that a forecast is correct because it was committed.

Full spec: [`launch-auditor-spec-v0.2.md`](./launch-auditor-spec-v0.2.md).

## Layout

```
apps/
  api/        Fastify HTTP API (spec §9)
  worker/     BullMQ jobs: watcher, features, outcomes, commits, deepdive, metabolism
packages/
  db/         Prisma schema + client (Postgres)
  chain/      viem client for chain 4663 + Blockscout API v2 client
  scoring/    forecaster + metric types, base-rate / Brier helpers (scorer proper: M4)
```

## Prerequisites

- Node >= 22 (24 works), pnpm 11
- Docker Desktop — for local Postgres + Redis (not needed for `pnpm verify`)

## Quickstart

```bash
pnpm install
cp .env.example .env        # fill in as milestones require; M0 needs nothing
pnpm verify                 # prisma schema + typecheck + vitest, all offline
```

Bring up the database (needs Docker):

```bash
docker compose up -d
pnpm db:migrate
```

## Verify

```bash
pnpm verify
```

Runs `prisma generate` + `prisma validate` + `tsc --noEmit` for every package + the
vitest suites, and prints a green summary. No Docker, no network, no paid APIs.

## Milestones

Tracked in [`CHANGELOG.md`](./CHANGELOG.md). Current: **M0 — Scaffold**.
