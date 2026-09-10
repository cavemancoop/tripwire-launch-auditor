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
