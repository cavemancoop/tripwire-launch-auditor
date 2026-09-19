# Tripwire Launch Auditor

Precommitted exit-risk oracle for Robinhood Chain (chain 4663). For every new token
launch it computes deterministic manipulation / exit-risk features within seconds,
publishes probabilities for five mechanically-defined outcomes (eleven outcome×horizon
cells in total), signs and commits the
forecast on-chain **before** the outcome can be known, and later grades every forecast
with an open-source scorer against those outcomes and against public baselines.

What it claims: the forecast existed before the outcome; the scorer is reproducible;
the baseline comparison is public. What it does **not** claim: that it pays for itself,
that no human touched the server, or that a forecast is correct because it was committed.
What it claims about the agent's own account: every dollar of compute it has ever spent came
from an on-chain CREDIT activation, each one a public transaction (dashboard → Funding).

Full spec: [`launch-auditor-spec-v0.2.md`](./launch-auditor-spec-v0.2.md).

## Summary (200 words)

Text for an external submission form or one-pager — stays inside what's
actually provable today.

> Tripwire Launch Auditor watches every new token on Robinhood Chain, computes
> deterministic manipulation and exit-risk features within seconds, and
> publishes separate probabilities for five mechanically defined outcomes —
> insider exit, sell impairment, liquidity impairment, 80% drawdown, still
> trading — at fixed horizons. Every forecast is signed and its hash
> committed on-chain before the outcome can be known; an open-source scorer
> later grades it against chain data and against public baselines, including
> the existing scanners' own verdicts. The product is not the warning but the
> track record.
>
> The agent authenticates with a key derived by signing a message with its
> own wallet — no browser session, no minted-then-revoked key, nothing that
> expires. It reads its balance from the gateway's API, sizes its daily
> research budget from CREDIT accrued on-chain in the trailing 24 hours, and
> writes every state change to a signed lifecycle log — it never holds or
> converts money. Anyone holding $ORBIO can clone the repo, authorize once,
> and run their own instance.

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

## Metabolism — Orbio MCP client + lifecycle runner + spend ledger (M5b-1 / M5b-2 / M5b-3)

The deep-dive's compute is funded through the Orbio MCP (spec §8). `apps/worker/src/metabolism/orbio-client.ts`
is a Streamable-HTTP MCP client for `ORBIO_MCP_URL` with an OAuth 2.1 provider whose
registration + tokens persist encrypted (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) via
`token-store.ts` — no token in the DB, logs, or `.env`.

```bash
# one-time browser sign-in (wallet holding $ORBIO); stores an encrypted token
pnpm orbio:auth

# call each wrapper once against LIVE Orbio and record test/fixtures/orbio/*.json
pnpm orbio:probe --yes
```

Five typed, zod-validated wrappers (the entire live tool set as of 2026-09-09 — the
spec's `orbio_claim_key` / `orbio_rotate_key` do not exist):

| wrapper | args | effect |
|---|---|---|
| `orbioGetBalance` | — | `balance.usd` = spendable quota (a key holds no money) |
| `orbioCreateKey` | `{ label?: ≤60 }` | mints a key, secret **once**, retires any existing key (claim + rotate in one) |
| `orbioGetKeyStatus` | — | `hasKey`, `prefix`, `createdAt`, `lastUsedAt`, base URLs |
| `orbioRevokeKey` | — | disables the current key; **no** balance change / refund |
| `orbioDeleteKey` | — | legacy only: disables the pre-gateway OpenRouter key, returns its unspent to balance — **one-way** |

`pnpm orbio:probe` mutates live account state (three of the five calls) and refuses to
run without `--yes`. Wrapper schemas are calibrated to the recorded fixtures and
exercised offline by `apps/worker/test/orbio-client.test.ts`.

### Lifecycle runner (M5b-2)

`runLifecycleLoop` starts with the worker when both `AGENT_EIP712_PRIVATE_KEY` and
`TOKEN_ENCRYPTION_KEY` are set. Every `METABOLISM_STATUS_POLL_SEC` (60s) it polls
`orbio_get_balance` + `orbio_get_key_status`, runs the adapted §8 state machine
(`decideLifecycle`, a pure function that drives `metabolism/state.ts`), acts via the
wrappers, and appends signed rows to `lifecycle_log`.

- **States:** `NO_KEY → ACTIVE → DRAINING`; hygiene `→ ROTATING → ACTIVE`;
  `balance − RESERVE_USD ≤ 0 → STARVED` (no rotate — a fresh key spends the same
  balance); ledger-vs-provider spend mismatch `→ REVOKING → NO_KEY` then **HALT**
  (awaits a human `pnpm orbio:auth`).
- **Config:** `RESERVE_USD` (3), `METABOLISM_LOW_WATER_USD` (2×reserve),
  `METABOLISM_HYGIENE_ROTATE_DAYS` (7), `METABOLISM_IDS_TOLERANCE_USD` (0.01),
  `METABOLISM_IDS_GRACE_USD` (`DEEPDIVE_CAP_PER_RUN_USD` + 0.05).
- **Signed log:** one row per transition + one snapshot per tick. Each row's
  `bodyHash = keccak256(RFC-8785(body))`, chained via `prevHash`, signed
  (EIP-191) by the agent key. Hashing lives in `@launch-auditor/db`
  (`lifecycleBodyHash` / `verifyLifecycleRows`) so the worker and API agree.
- **Endpoint:** `GET /v1/lifecycle?limit=200` (spec §9, free) returns the rows
  oldest→newest with a server-side `verified` boolean; the rows are also
  independently verifiable offline.
- The minted gateway key (secret) is persisted encrypted in the same token store
  (`gatewayKey`) so a worker restart does not orphan it; the M6 deep-dive reads it.

### Spend ledger + IDS reconciler (M5b-3)

- `metabolism/spend-ledger.ts` — `recordSpend` / `totalSpendUsd` / `spendByKey`
  over the `MetabolismSpend` table, one row per `llm_deepdive_v0` run, idempotent
  on the OpenRouter `generationId`. **The spender is the M6 deep-dive** — M5b-3 is
  the API + reconciler only; M6 wires the call sites.
- `metabolism/ids-reconcile.ts` — `reconcileIds` (pure). Orbio exposes only an
  account-wide gateway `spent.usd`, so the check runs against a **per-key
  baseline**: when a key is minted the runner snapshots `(provider spent,
  ledger Σ)` into the encrypted store (`spendBaseline`); each tick it compares the
  two *deltas since that snapshot*. Only the provider outpacing the ledger beyond
  `max(METABOLISM_IDS_TOLERANCE_USD, METABOLISM_IDS_GRACE_USD)` is a compromise
  signal → REVOKING → NO_KEY → HALT. Ledger-ahead (unsettled / over-recorded) is
  logged, never revoked.

## LLM deep-dive `llm_deepdive_v0` (M6)

The Orbio-funded scored forecaster (spec §5). Pipeline (`apps/worker/src/deepdive/`):

1. **budget gate** — `deepdiveRunGate`: `min(DEEPDIVE_CAP_PER_RUN_USD, dailyCap −
   today's spend, balance − RESERVE_USD)`; a run is skipped when nothing is affordable.
2. **frozen packet** (`packet.ts`) — RPC chain-id cross-check, block pin
   `{number, hash, timestampUtc}`, runtime code hash + EIP-1967 proxy resolution.
3. **agent loop** (`agent.ts`) — `@openrouter/agent` `callModel` on the Orbio gateway,
   8 read-only tools (`address_token_activity`, `token_transfers`, `cluster_expand`,
   `price_series`, `holder_snapshot`, `contract_code`, `scanhood_scan`, `scanhood_quote`)
   + `web_search`, `stopWhen: [stepCountIs, maxCost]`, strict JSON output
   `{p_insider_exit_24h, p_drawdown_80_7d, p_sell_impaired_24h, evidence, confidence}`.
   Every tool result is an evidence row; a failed read is a limitation, never a finding (§8.2).
4. **assemble + sign + validate** (`report.ts`) — a `Report` with
   `forecaster = llm_deepdive_v0`, EIP-712 signed, run through the §8.3 validator,
   persisted like `det_v0` (so the §2 scorer picks it up with no special casing).
5. **cost** (`cost.ts`) — one `MetabolismSpend` row per generation, costed from
   `GET /generation?id=`, tagged with the gateway key.

**Triggers:** `runDeepdiveLoop` sweeps qualified-lane launches (budget-gated);
`POST /v1/deepdive/{token}` enqueues an on-demand run on the `deepdive` queue
(free during the contest; x402 gating is M7). Both need `OPENROUTER_MODEL_DEEPDIVE`
set to a **pinned exact slug** (no `~latest` / `openrouter/auto`) — `assertScoredModelSlug`
refuses otherwise, since the model must be identifiable per report.

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

## Fork-and-run (spec §8.1)

This is the property the Orbio red-team test (spec §0.1) actually checks: anyone
holding $ORBIO can clone this repo, authorize once, and run their own instance —
with **no card, no top-up from a fiat rail, no payment rail**. Three steps, end to end
(this deployed instance's own funding is disclosed on the dashboard's Metabolism →
Funding panel — see [DEMO.md](./DEMO.md)):

```bash
# 1. clone + configure
git clone <this repo> && cd launch-auditor
pnpm install
cp .env.example .env
# fill in: RH_RPC_URL, DATABASE_URL/REDIS_URL (or use docker compose below),
# COMMIT_REGISTRY_ADDRESS + AGENT_EIP712_PRIVATE_KEY + GAS_WALLET_PRIVATE_KEY,
# ORBIO_MCP_URL (default is fine), TOKEN_ENCRYPTION_KEY (pnpm orbio:auth prints
# one on first run if it's blank)
docker compose up -d && pnpm db:migrate

# 2. no browser, no session, ever — the agent's API key is its own wallet's
# signature. Set ORBIO_KEY_SOURCE=wallet and point GAS_WALLET_PRIVATE_KEY at a
# wallet you control. (The original browser OAuth flow still exists as a
# fallback: METABOLISM_SOURCE=mcp, then `pnpm orbio:auth`.)

# 3. run everything
pnpm start
```

`pnpm start` runs the watcher, the metabolism lifecycle loop, the commit loop, the
outcome resolver, the deep-dive worker, the free-feed Telegram poster, a periodic
benchmark snapshot, the API, and the dashboard — all from one command
(`scripts/start.mjs`; no extra dependency, just child processes sharing this
terminal). From here the agent mints and manages its own Orbio gateway key without
further human input — its key is a standing wallet signature, not a session, so
nothing expires; see [Metabolism](#metabolism--orbio-mcp-client--lifecycle-runner--spend-ledger-m5b-1--m5b-2--m5b-3)
below for what "without further human input" covers and doesn't.

Open the dashboard at `http://localhost:3002` (`WEB_PORT`) once everything is up.

## API (M7, spec §9)

All free during the contest (x402 / API-key payment gating on `/v1/deepdive` is
deferred — see spec §9, "payments only if time remains"). Base URL: `http://localhost:3000`.

| Endpoint | What it does |
|---|---|
| `GET /v1/launches?limit=` | Live launch feed: latest non-retrospective launches with their `det_v0` forecast + commit-proof pointer. |
| `GET /v1/report/:token` | Every forecaster's latest forecast for a token, with evidence and proof status. |
| `GET /v1/launch/:token` | The inputs behind those forecasts: primary-pool evidence (pool kind/address/fee, `poolFeeSuspect`, `tokenAgeAtPoolSec`), the raw feature vector + provenance, and every outcome row (status/value/evidence/coverage). Added M11b so the published benchmark can be reproduced from public data, not just asserted (Codex Phase A #2 / B #2). |
| `POST /v1/assess/:token` | Enqueues one on-demand report for an already-indexed token, any age. *Scope note:* the spec's "daily re-scores for 7 days" is the recurring/event-aware re-scoring layer (v0.3 Watch, spec §10.1) — not built; this triggers a single immediate report. |
| `POST /v1/deepdive/:token` | Enqueues an on-demand `llm_deepdive_v0` run. |
| `GET /v1/benchmark` | The public benchmark table (all forecasters, sample sizes). Served from a snapshot the worker recomputes every 5 minutes (`data/benchmark.json`) — the API does no scoring compute itself. Shape (M8): `{ generatedAt, all, live }`, both full `Benchmark` objects (`scope: 'both'` vs `'live'`); the dashboard diffs a cell's `n` between the two to badge how much of it is retrospective (backfill). |
| `GET /v1/proof/:hash` | A report's Merkle proof, verified locally, plus a best-effort on-chain confirmation of its batch root (an RPC hiccup reports `onChainConfirmed: null`, never `false`). |
| `GET /v1/lifecycle` | The signed key-lifecycle log, independently verifiable, plus (M5c) the metabolism's own cost-forecast error over the trailing 24h. |
| `POST /mcp` | MCP server (Streamable HTTP, stateless): `get_report`, `get_benchmark`, `request_deepdive` — the same endpoints with no HTTP client needed. |

`x-api-key` (checked against `DESIGN_PARTNER_API_KEYS`) is accepted and echoed back as
`designPartner: true|false` on `/v1/assess` and `/v1/deepdive` — it doesn't gate
anything yet, since nothing is priced yet.

## Dashboard + free feed (M8)

`apps/web` is a static dashboard — no build step, no framework, just a
dependency-free static file server (`node:http`) serving plain HTML/CSS/JS that
fetches the API client-side. Panels, in the order spec §0.1 prioritizes them:

1. **Metabolism** — active key remaining, credits accrued/hr (derived from the
   signed lifecycle log's `balanceUsd` samples), spend per report, rotation/
   revocation counts, billing status, today's deep-dive budget (mirrors the
   worker's live gate — `apps/api/src/budget-display.ts`, duplicated the same
   way `merkle.ts` is), and the lifecycle chain's verified span.
2. **P&L, trailing 24h** — two boxes, standalone (what the same compute would
   have cost on a plain OpenRouter account — the spec §0.1 red-team question,
   answered in dollars) and Orbio-subsidized (what was actually spent: $0 cash).
3. **Live launches** — `GET /v1/launches`, with each `det_v0` forecast and a
   direct Blockscout link to its commit proof.
4. **Benchmark** — `GET /v1/benchmark`, sample sizes, an "insufficient sample"
   badge, a "+N retro" badge per cell, and "beats X p=…" where a claim clears
   the bar. `base_rate_fixed` (constant per-cell climatology, added
   2026-09-17) sits alongside the rolling `base_rate` as the honest floor —
   the rolling baseline is time-varying and scored below chance live, so a
   claim against it alone can overstate what a model adds.
5. **Key lifecycle** — the signed `lifecycle_log` chain, most recent first.

No number here is invented: everything is either a raw API field or a labelled
derivation (e.g. "credits accrued/hr" sums positive `balanceUsd` deltas over
however many samples the log currently holds, and says so).

The free feed is a worker loop (`apps/worker/src/telegram/poster.ts`): every
`TELEGRAM_POSTER_INTERVAL_MS` it posts each qualified-launch `det_v0` report
(once it has a commit, so the proof link resolves) to `TELEGRAM_CHANNEL_ID` via
`TELEGRAM_BOT_TOKEN`, and stamps the report's `telegramPostedAt` after the send.
That's best-effort deduplication: a crash between the send and the stamp can
repeat one post. Unset either env var and the poster logs once that it's
disabled and does nothing — it never spams a channel nobody configured.

What a post says (M12b) is limited to what the benchmark supports. `det_v0`
beats both base rates at *ranking* insider exit (24h) and still trading (24h),
and its probabilities are miscalibrated on every cell. So a post shows a rank
tier on those two cells (top 10% / top 25% / middle half / bottom 25%) against
the qualified launches anchored in the previous 24h, with at least 20 peers or
"not ranked". It never shows a raw probability, and drawdown isn't posted
because `det_v0` ranks it backwards. A report whose batch committed more than
30 minutes after its T+10m anchor is not posted at all. Each post states its
measured commit lag instead of an unqualified "committed before outcome".

## Deploy (M9, Railway)

Three services (api, worker, web) plus Postgres and Redis add-ons, all in one
Railway project. `railway.json` at the repo root describes all three
services' build config as code — if your Railway version doesn't pick that up
automatically, the manual steps below create the same thing by hand.

### 1. Add the data stores
In the Railway project: **+ New → Database → PostgreSQL**, then **+ New →
Database → Redis**. Railway generates `DATABASE_URL` / `REDIS_URL` variables
on those two services — reference them from api/worker as
`${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}` (Railway's variable
reference syntax) rather than copy-pasting the literal connection string, so
they never drift if Railway rotates credentials.

### 2. Create the three app services
This repo is a pnpm monorepo — one GitHub repo, three Railway services, each
built from its own Dockerfile with the **whole repo** as build context
(needed because every app depends on `packages/*` via the workspace
protocol). For each of `api`, `worker`, `web`:
- **+ New → GitHub Repo** → this repo.
- Service **Settings → Source**: leave **Root Directory** blank (repo root —
  the build context every Dockerfile needs), set **Dockerfile Path** to
  `apps/<name>/Dockerfile`, and confirm **Builder** is Dockerfile (not
  Nixpacks/Railpack — auto-detect will fail on a 3-app monorepo, which is
  exactly the "Railpack could not determine how to build the app" error this
  project hit before the Dockerfiles existed).
- **Settings → Networking**: only `api` and `web` need a public domain
  (**Generate Domain**). `worker` needs no public networking — Railway's own
  crash/restart supervision is enough for a background service; give it a
  **private** domain only if you want to curl its `/health` from inside the
  project.

### 3. Environment variables
Every service needs `DATABASE_URL` and `REDIS_URL` (variable references, see
above). Beyond that:

| Service | Needs | Where it comes from |
|---|---|---|
| worker | `RH_RPC_URL`, `CHAIN_ID` | your RPC provider |
| worker | `AGENT_EIP712_PRIVATE_KEY`, `GAS_WALLET_PRIVATE_KEY` | the agent's own signing/gas keys (spec §6) |
| worker | `COMMIT_REGISTRY_ADDRESS` | `forge script` deploy output |
| worker | `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| worker | `OPENROUTER_MODEL_DEEPDIVE` | pinned exact slug — see `.env.example` for the current one and why |
| worker | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | `@BotFather` + the channel you add the bot to |
| worker | `TELEGRAM_ALERTS_CHANNEL_ID` (optional) | a separate ops channel; unset falls back to the free-feed channel |
| worker | `WORKER_PORT` (optional) | the worker's `/health` listener; defaults to 3010. **Not** `PORT` — this repo's `.env` already sets `PORT=3000` for the api, and both processes read the same file locally, so the worker deliberately doesn't fall back to a bare `$PORT` |
| api | `RH_RPC_URL`, `CHAIN_ID`, `COMMIT_REGISTRY_ADDRESS` | same values as worker, read-only here (proof verification) |
| api | `DESIGN_PARTNER_API_KEYS` (optional) | comma-separated, your own choice |
| api | `PORT` | Railway injects this automatically |
| web | `PORT` | Railway injects this automatically; `server.mjs` reads `PORT` first, then the local-dev-only `WEB_PORT` (default 3002) |

Everything else in `.env.example` has a working default and doesn't need to
be set for a first deploy. See `.env.example` itself for what each one does
and, where relevant, why (e.g. the OAuth refresh finding, the RPC comparison
table).

After the first deploy: run `pnpm db:migrate` once against the production
`DATABASE_URL` (from your own machine, with `DATABASE_URL` in your shell
pointed at Railway's Postgres) to apply the schema, or wire it as a Railway
deploy-time command — the migrations directory is already in the repo.

### 4. Health, metrics, alerts
- `GET /health` — on api and worker.
- `GET /metrics` — on api; Prometheus text exposition (`launch_auditor_*`
  gauges: watcher staleness, commit age, metabolism state, IDS/phantom flag,
  24h launch/report counts). Point a Prometheus scrape config or Railway's
  own metrics import at it.
- Telegram alerts (`apps/worker/src/alerts.ts`): STARVED, IDS trip
  (`idsMismatch` or a phantom-spend epoch), commit lag > 10 min, watcher
  stalled > 5 min. Edge-triggered — one message when a check goes bad, one
  recovery message when it clears, silence in between.

### 5. Verify the deploy
Per the build guide's own check: the production URL serves the dashboard;
commits keep landing (`GET /v1/lifecycle` and the chain's own commit registry
agree); then kill your **local** `pnpm start` instance and confirm the
Railway server is the only one still committing (no double-commits, no gap).

## Verify

```bash
pnpm verify
```

Runs `prisma generate` + `prisma validate` + `tsc --noEmit` for every package + the
vitest suites, and prints a green summary. No Docker, no network, no paid APIs.

## Milestones

Tracked in [`CHANGELOG.md`](./CHANGELOG.md). Current: **M9 — Railway deploy**.
