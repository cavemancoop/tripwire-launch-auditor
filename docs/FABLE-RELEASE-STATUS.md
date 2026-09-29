# Fable engineering release status

Updated 2026-09-29. Public `main` includes the independently reviewed Fable
stabilization packages, including the bounded scorer-read repair and the M2
read paths from [PR #18](https://github.com/cavemancoop/tripwire-launch-auditor/pull/18).
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
  counts, plus fixed JSON-RPC method attempt buckets. The first live 50-row
  cell log reconciled to its sweep summary; live method counts reconciled to
  the aggregate attempt counter.
- Per-cell RPC attempt attribution from PR #17, and M2 policy-exclusion
  benchmark/API read paths from PR #18. No historical row was reclassified.

The scorer-read repair bounds snapshot reads. The preceding production
worker fetched all validated reports before filtering against resolved
outcomes; its first post-PR #18 pass failed after about 18 minutes with a
closed database connection, leaving `/v1/benchmark` stale. The repair
narrows reports by the exact resolved observation key and batches baseline
launch-source lookups. A fresh successful live snapshot is needed to confirm
its operational effect.

## Verification

Run `pnpm verify` for Prisma generation and validation, workspace typechecks
and offline Vitest suites. The PR #18 release passed 623 worker tests;
Foundry is unavailable, so contract tests were skipped. No contract changed.
Each public change requires an independent review of its exact candidate,
merge-SHA deployment checks and a live observation before its status is called
operationally verified. The scorer-read repair still needs a fresh live snapshot.

## Open gates

- Measure Chainstack account request-unit burn with a second dated console
  reading. A worker attempt is not necessarily one billed request unit.
- Observe live per-cell attempts and measure representative, matched
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
