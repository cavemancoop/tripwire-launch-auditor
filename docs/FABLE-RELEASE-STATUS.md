# Fable engineering release status

This release candidate applies the reviewed repository-local work from the
Fable implementation loop to the production base `23d81a4`. Its application
source matches local checkpoint `67c1dbc` (round 9). It includes no schema
migration, new environment variable, contract change, or change to the public
API response shape.

## Included work

- **Package 2a — worker observation:** fixed-label RPC scheduler counters,
  process memory and uptime on the private worker `/metrics` route, and a
  bounded one-minute `[obs]` log line. `/health` remains unchanged; metrics
  collection failures return a fixed 503 response.
- **Package 2b — loop observation:** outcome sweep timing, selection/result
  counts, and outcomes/scorer loop success and error counters. These are
  process-local and reset on restart. A sweep that throws may omit partial row
  counts; the failure and duration still appear.
- **Package 4a — provider failure safety:** shared typed RPC classification,
  quota-aware deferral, credential redaction in new outcome diagnostics, and
  regression coverage for nested provider errors. Quota failures and nested
  429s leave affected outcome rows pending for retry. The existing v1
  DRAWDOWN_80 grading interpretation remains in force for historical rows.

## Local verification

On the publishable tree, `node scripts/verify.mjs` passed Prisma generation
and validation, all workspace typechecks, and 829 Vitest tests across six
packages. The test count was 34 chain, 8 database, 59 scoring, 70 RPC budget,
76 API, and 582 worker. The checks ran in an isolated, network-disabled copy.

Forge contract tests were skipped because Forge is unavailable. This change
does not edit contracts. The local check does not prove behavior against a
live RPC provider or production Postgres.

## Remaining work and evidence

Package 4b cancellation and row ownership is still under development. The
agent loop's later checkpoints are not part of this release. Deployment
health, worker logs, and production observation must be recorded against the
exact published commit. No seven-day throughput or quality target is claimed
from local tests. Rule changes, corrections to historical data, and provider
budget changes require separate decisions.
