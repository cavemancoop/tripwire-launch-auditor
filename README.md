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
with **no card, no top-up, no payment rail**. Three steps, end to end:

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

# 2. one-time browser sign-in — the ONLY interactive step, ever
pnpm orbio:auth

# 3. run everything
pnpm start
```

`pnpm start` runs the watcher, the metabolism lifecycle loop, the commit loop, the
outcome resolver, the deep-dive worker, a periodic benchmark snapshot, and the API —
all from one command (`scripts/start.mjs`; no extra dependency, just two child
processes sharing this terminal). From here the agent mints and manages its own
Orbio gateway key without further human input; see [Metabolism](#metabolism--orbio-mcp-client--lifecycle-runner--spend-ledger-m5b-1--m5b-2--m5b-3)
below for what "without further human input" is currently bounded by.

## API (M7, spec §9)

All free during the contest (x402 / API-key payment gating on `/v1/deepdive` is
deferred — see spec §9, "payments only if time remains"). Base URL: `http://localhost:3000`.

| Endpoint | What it does |
|---|---|
| `GET /v1/launches?limit=` | Live launch feed: latest non-retrospective launches with their `det_v0` forecast + commit-proof pointer. |
| `GET /v1/report/:token` | Every forecaster's latest forecast for a token, with evidence and proof status. |
| `POST /v1/assess/:token` | Enqueues one on-demand report for an already-indexed token, any age. *Scope note:* the spec's "daily re-scores for 7 days" is the recurring/event-aware re-scoring layer (v0.3 Watch, spec §10.1) — not built; this triggers a single immediate report. |
| `POST /v1/deepdive/:token` | Enqueues an on-demand `llm_deepdive_v0` run. |
| `GET /v1/benchmark` | The public benchmark table (all forecasters, sample sizes). Served from a snapshot the worker recomputes every 5 minutes (`data/benchmark.json`) — the API does no scoring compute itself. |
| `GET /v1/proof/:hash` | A report's Merkle proof, verified locally, plus a best-effort on-chain confirmation of its batch root (an RPC hiccup reports `onChainConfirmed: null`, never `false`). |
| `GET /v1/lifecycle` | The signed key-lifecycle log, independently verifiable, plus (M5c) the metabolism's own cost-forecast error over the trailing 24h. |
| `POST /mcp` | MCP server (Streamable HTTP, stateless): `get_report`, `get_benchmark`, `request_deepdive` — the same endpoints with no HTTP client needed. |

`x-api-key` (checked against `DESIGN_PARTNER_API_KEYS`) is accepted and echoed back as
`designPartner: true|false` on `/v1/assess` and `/v1/deepdive` — it doesn't gate
anything yet, since nothing is priced yet.

## Verify

```bash
pnpm verify
```

Runs `prisma generate` + `prisma validate` + `tsc --noEmit` for every package + the
vitest suites, and prints a green summary. No Docker, no network, no paid APIs.

## Milestones

Tracked in [`CHANGELOG.md`](./CHANGELOG.md). Current: **M0 — Scaffold**.
