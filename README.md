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
  worker/     BullMQ jobs. M1: pool-creation watcher (v2/v3/v4) + index-lane features + T+10m job
packages/
  db/         Prisma schema + client (Postgres)
  chain/      viem client for chain 4663, Blockscout v2 client, Uniswap pool-event decoders,
              chain/launchpad address config (config/chain.4663.json), source attribution
  scoring/    forecaster + metric types, base-rate / Brier helpers (scorer proper: M4)
```

## Watcher (M1)

```bash
pnpm dev:worker                          # live: poll pool creation every 2s, index every launch
pnpm watcher:replay --from <block>       # re-ingest a past range (--span <blocks> for windows)
```

Needs `RH_RPC_URL` in `.env` (chain 4663). Writes `launches` + `features` rows; a
delayed job fills T+10m features. Launchpad attribution (`source`) is `raw` until the
per-pad factory addresses in `packages/chain/config/chain.4663.json` are confirmed and
their `verified` flags flipped.

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
