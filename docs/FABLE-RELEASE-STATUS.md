# Fable engineering release status

Updated 2026-09-29 03:30 UTC. At that time public `main` was merge `e98d98b`,
including the bounded scorer-read repair ([PR #19](https://github.com/cavemancoop/tripwire-launch-auditor/pull/19)),
staged M2 correction safety tooling ([PR #20](https://github.com/cavemancoop/tripwire-launch-auditor/pull/20)),
and lane-stratified benchmark sections ([PR #22](https://github.com/cavemancoop/tripwire-launch-auditor/pull/22)).
Railway API, worker and web reached SUCCESS on that exact commit. This page
records the current release boundary; a passed test suite is not a seven-day capacity
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
- PR #20 added an inactive correction ledger and manual, guarded preview,
  prepare, apply and revert commands. The ordinary worker does not call them.
  Public policy-excluded gauges remained zero after deployment.
- PR #22 added index and qualified sections to the live benchmark without
  changing outcome truth, score eligibility or provider limits. At the dated
  public-main check above, the dashboard still showed only the pooled table.

The scorer-read repair bounds snapshot reads. The preceding production
worker fetched all validated reports before filtering against resolved
outcomes; its first post-PR #18 pass failed after about 18 minutes with a
closed database connection, leaving `/v1/benchmark` stale. The repair
narrows reports by the exact resolved observation key and batches baseline
launch-source lookups. Its first replacement-worker pass completed about
78,736 score rows in roughly 86 seconds, a second pass completed about 78,775
rows. After PR #20, the public benchmark generatedAt advanced to 02:26:43 UTC
and the worker logged completion of its 79,010-row snapshot at 02:28 UTC.
These successful passes confirm recovery of the immediate read failure, not indefinite scorer
capacity as the dataset grows.
After PR #22, the worker completed its first 79,184-row snapshot in about
90 seconds. The public API exposed both launch lanes, and all 53 pooled
outcome/forecaster cell counts equaled the sum of their lane counts.

A separate read-only production aggregate revisited the September 28 UTC
due-entry cohort at 03:18 UTC on September 29. All **39,006** rows in current
resolver scope were still PENDING; none had a terminal result. Every linked
launch had a completed T+10 feature timestamp at that read. All **4,136**
terminal writes made during September 28 served rows first due on September
16, 17, 18 or 21. The cohort query used
`GREATEST(outcomes.horizonAt, outcomes.createdAt)` within the half-open day,
current launch lane and policy scope, and a five-second statement timeout.
This is a dated status observation, not a prediction of eventual completion.

## Dashboard change in this release

Panel 04 renders PR #22's lane sections below the existing pooled table as
descriptive diagnostics without lane-specific beat badges. It labels their
selected sample and current-lane limitations. This page records
the local release candidate; the new dashboard view still requires an exact
merge/deployment check and public render observation before it is called
operationally verified.

## Verification

Run `pnpm verify` for Prisma generation and validation, workspace typechecks
and offline test suites. PR #22 passed 627 worker tests; the dashboard lane
render has two focused Node tests. PR #20's guarded
PostgreSQL 16 test passed separately with a real pre-change dump and restore.
Foundry was unavailable, so contract tests were skipped. No contract
changed.
Each public change requires an independent review of its exact candidate,
merge-SHA deployment checks and a live observation before its status is called
operationally verified.

## Open gates

- Measure Chainstack account request-unit burn with a second dated console
  reading. A worker attempt is not necessarily one billed request unit.
- Observe a full matched day of PR #17 per-cell RPC attempts and terminal
  service, then repeat cohort completeness by due day. The September 28
  cohort's zero terminal count shows why today's graded rows cannot be
  treated as a random or recent sample.
- Decide any prospective workload narrowing, horizon pause or v2 outcome rule
  against a frozen comparison cohort. Existing rows and the current provider
  cap remain unchanged until that decision.
- Decide and authorize any historical M2 correction separately. A read-only
  preview with cutoff 02:28 UTC counted 755,834 PENDING rows for three labels,
  linked to completed-T+10 index-lane launches and created by that cutoff.
  Before any production write, verify an off-volume
  backup by restoring it and establish peak database/WAL headroom. The current
  5,000 MB volume was using about 2.52 GB; adding tables changed no outcome row.
- Observe alerts, core-path health and cohort coverage for a full seven-day
  window; configure external worker/feed-silence monitoring; test the event
  index only if the measured gate warrants it.

The original first-release record is in the Git history at PR #1. Its
829-test count and pending-package list describe that earlier candidate, not
the current public release.
