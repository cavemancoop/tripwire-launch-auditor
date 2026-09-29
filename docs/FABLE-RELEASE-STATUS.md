# Fable engineering release status

Updated 2026-09-29. Public `main` includes the independently reviewed Fable
stabilization packages through [PR #15](https://github.com/cavemancoop/tripwire-launch-auditor/pull/15).
It is running on the Railway API, worker and web services. This page records
the current release boundary; a passed test suite is not a seven-day capacity
or outcome-quality claim.

## Shipped and observed

- Same-block DRAWDOWN_80 v1 regression coverage; the proposed zero-swap
  fallback that would have changed historical grading was held.
- Worker and loop metrics, typed provider failures, quota-safe deferrals,
  cancellable RPC retries, and expiring ownership of outcome rows. The claim
  schema migration was deployed before outcome resolution was re-enabled.
- Commitment ordering, bounded proof caching, assessment admission controls,
  durable alert state, live deterministic report-lag checks, and a provider
  quota/failure alert. These alerts cannot detect a worker that is itself down.
- Budgeted worker transport attempt totals and per-outcome-cell sweep-service
  counts. The first live 50-row cell log reconciled to its sweep summary.

The current candidate adds fixed JSON-RPC method buckets to the existing
budgeted transport counters. These count attempts including retries, not
provider-billed request units or wallet/API traffic. They do not change RPC
admission, resolution, scoring, report commitments or the public API.

## Verification

Run `pnpm verify` for Prisma generation and validation, workspace typechecks
and offline Vitest suites. The current candidate passed 621 worker tests;
Foundry is unavailable, so contract tests were skipped. No contract changed.
Each public change requires an independent review of its exact candidate,
merge-SHA deployment checks and a live observation before its status is called
shipped. The new method counters still need those release checks.

## Open gates

- Measure Chainstack account request-unit burn with a second dated console
  reading. A worker attempt is not necessarily one billed request unit.
- Attribute attempts to outcome cells and measure representative, matched
  arrival/service windows. The public benchmark already discloses that
  graded rows are selected, not a random sample.
- Decide any prospective workload narrowing, horizon pause or v2 outcome rule
  against a frozen comparison cohort. Existing rows and the current provider
  cap remain unchanged until that decision.
- Rehearse and authorize any historical M2 correction separately. The
  additive enum schema alone did not rewrite production rows.
- Observe alerts, core-path health and cohort coverage for a full seven-day
  window; configure external worker/feed-silence monitoring; test the event
  index only if the measured gate warrants it.

The original first-release record is in the Git history at PR #1. Its
829-test count and pending-package list describe that earlier candidate, not
the current public release.
