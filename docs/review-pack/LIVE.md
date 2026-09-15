# Live system

Everything a reviewer needs to test the running instance. **Nothing in this pack is
a credential.** Addresses are public on-chain identities; key prefixes that appear in
the docs (`sk-orbio-XXXXXX`) are 6-character labels that cannot authenticate.

Snapshot: 2026-09-15, repo `main` @ `d61dc20` (deployed to Railway on this date).

## Addresses and links

| What | Value |
|---|---|
| Dashboard | https://web-production-ddcf3.up.railway.app |
| API base | https://api-production-6a84.up.railway.app |
| Telegram free feed | https://t.me/tripwirelaunchauditor (`@tripwirelaunchauditor`) |
| Chain | Robinhood Chain, chain id 4663 |
| Explorer | https://robinhoodchain.blockscout.com |
| CommitRegistry contract | `0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe` — https://robinhoodchain.blockscout.com/address/0xF36F84a7B7DfFB952341d021db51bD76E54fDBEe |
| Agent signer (EIP-712 reports, EIP-191 lifecycle rows) | `0x6a5A2d5Ad4c4De33f851f971fa14923f5095B4BE` |
| Gas wallet (sends `commitBatch` / `commitArtifact`) | `0x9b4EDe199198ca3D41A9a7D2997606BaCd30BA03` — https://robinhoodchain.blockscout.com/address/0x9b4EDe199198ca3D41A9a7D2997606BaCd30BA03 |
| Public RPC (no key) | `https://rpc-robinhood.blockmachine.io` |

The production worker uses a paid RPC that is **not** included. The public RPC above
is the one the project uses locally; per `field-report-2026-09-11.md` §06 an earlier
provider had archive problems, so historical `eth_call` at old blocks may fail or be
slow on it — record that as "could not verify", not as a project failure, unless the
project's own code depends on it.

## Endpoints — what is safe to call

| Endpoint | Effect | Reviewer may call? |
|---|---|---|
| `GET /health` | read-only | yes |
| `GET /metrics` | read-only (Prometheus text) | yes |
| `GET /v1/launches?limit=` | read-only | yes |
| `GET /v1/report/:token` | read-only | yes |
| `GET /v1/benchmark` | read-only (serves the worker's 5-minute snapshot) | yes |
| `GET /v1/proof/:hash` | read-only (does one on-chain read of the batch root) | yes |
| `GET /v1/lifecycle?limit=` | read-only | yes |
| `GET /config.json` on the dashboard | read-only | yes |
| `POST /v1/assess/:token` | **writes**: enqueues a report job on the production worker, consumes its RPC budget | **no** |
| `POST /v1/deepdive/:token` | **spends**: enqueues an LLM run paid from the project's Orbio balance | **no** |
| `POST /mcp` → `get_report`, `get_benchmark` | read-only | yes |
| `POST /mcp` → `request_deepdive` | **spends**, same as `POST /v1/deepdive` | **no** |

Read the code for these (`apps/api/src/server.ts`, `apps/api/src/mcp.ts`) as much as you
like — reviewing whether the write endpoints are adequately protected is in scope.
Calling them against production is not.

Never call any Orbio endpoint (`www.orbio.so`, `api.orbio.so`), and in particular never
`POST /api/key`: `orbio_create_key` mints a new key **and retires the active one**,
which would stop the production agent.

## Verification commands

From `HANDOFF-2026-09-14.md` §7 and `HANDOFF-2026-09-15.md` §6, with credentialed
commands removed.

```bash
API=https://api-production-6a84.up.railway.app

# production metrics: watcher staleness, commit age, 24h volumes, metabolism state
curl -s $API/metrics | grep -v '^#'

# launch feed: det_v0 coverage and on-chain commit pointers
curl -s "$API/v1/launches?limit=200"

# benchmark: live vs all, per cell, with sample sizes and claim gates
curl -s $API/v1/benchmark

# signed lifecycle chain + M5c estimator + budget block (basis, balanceUnknown)
curl -s "$API/v1/lifecycle?limit=500"

# one report's Merkle proof and on-chain root confirmation
curl -s "$API/v1/proof/<reportHash>"

# the property-2 dead-code check (run in the repo)
grep -rn "dailyDeepdiveBudget\|trailingCreditsUsd" apps packages --include="*.ts" | grep -v /test/

# offline build + tests (no Docker, no network, no paid APIs)
pnpm install && pnpm verify
```

Not available to a reviewer: `railway logs --service worker` (needs the operator's
Railway login) and the production Postgres. Anything that needs worker logs or
direct DB rows should be marked "could not verify" with what you would have checked.

## Verifying a commitment independently

- Leaves are report hashes (lower-case `0x…` bytes32); the tree is sorted-pair
  `keccak256` (OpenZeppelin `MerkleProof` convention). Reference implementations:
  `apps/worker/src/commit/merkle.ts` (build) and `apps/api/src/merkle.ts` (verify).
- The registry keeps no root getter. Roots are in `BatchCommitted(uint256 indexed batchId,
  bytes32 merkleRoot, uint256 leafCount, uint256 timestamp)` events on the registry
  (ABI: `packages/chain/src/wallet.ts`). Fetch the tx from `/v1/proof` or the feed,
  read its logs on Blockscout or via `eth_getTransactionReceipt`, and compare the root.
- Artifact hashes (weights, feature code, outcome rules, scorer) are in
  `ArtifactCommitted(bytes32 indexed kind, bytes32 hash, uint256 timestamp)` events;
  `apps/worker/src/commit/artifacts.ts` computes the local hashes to compare.
- Report signatures are EIP-712 by the agent signer above; lifecycle rows are EIP-191
  signed and hash-chained (`packages/db`, `lifecycleBodyHash` / `verifyLifecycleRows`).

## Known state at snapshot time (so it is not mistaken for a finding you discovered first)

Record these as findings anyway if they matter. They are listed so the review does not
spend its time rediscovering them.

- Production has **no Orbio MCP session**: `/v1/lifecycle` returns zero entries and
  `balanceUnknown: true`. Deep-dives run on a gateway key pushed from the operator's laptop.
- `PUBLIC_API_BASE_URL` and `TELEGRAM_ALERTS_CHANNEL_ID` are unset on the worker (see B5 and
  the alerts note in `CLAIMS.md`).
- Some commit batches before 2026-09-15 ~05:27 UTC were re-anchored after a receipt timeout,
  so a few roots on-chain have no matching DB row (DECISIONS.md, 2026-09-15).
