# Fable cancellation release candidate

Base: public `main` at `2b87001` (PR #2). This branch carries the application
changes from independently reviewed local checkpoints `87acc19` and
`8b795ed`; the corresponding cherry-picks are `7fcab1d` and `aa1b5b9`.
The prior public release's application files matched local round 9, so the
integration includes only the round 11–12 cancellation slice. The stale
round-10 changelog entry was not carried over because it described already
published work as undeployed.

## Behavior

An outcome row that exceeds its 120-second deadline still becomes deferred,
but now its queued RPC calls, later log-scan chunks and subsequent transport
retries do not start. A request already sent may settle; its late result is
discarded. The transport's uncancelled retry policy remains under the shared
scheduler. The T+10m feature pass retains its previous deadline behavior
because it may persist a degraded fallback after an RPC error.

This release changes no grading rule, schema, migration, environment variable,
public API response or public claim. It does not solve concurrent ownership
of outcome rows. Package 4b remains incomplete until atomic expiring claims
and owner-guarded writes pass competing-sweeper tests. No second worker is
part of this release.

## Evidence gates

- Local round-12 canonical verification passed on the isolated agent branch;
  Codex's round-12 review accepted both cancellation findings. That review
  found row ownership still absent.
- Every changed application/test Git blob matches the independently reviewed
  `8b795ed` checkout. The canonical isolated verifier passed on this
  publishable tree at `aa1b5b9`: Prisma generate/validate, all workspace
  typechecks and 851 Vitest tests (37 chain, 8 database, 59 scoring, 84 RPC
  budget, 76 API and 587 worker). The verifier reported dependency-layout
  warnings from the copied test archive but exited 0. Forge was unavailable,
  so contract tests were skipped; this release does not edit contracts.
  Database-backed and live-provider behavior remain untested here. Check the
  final diff contains only intended application, test and release-note files.
- After deployment, confirm Railway worker, API and web report SUCCESS on the
  exact merge commit. Observe worker errors, deadline deferrals, per-tier RPC
  starts and outcome sweep progress against the pre-release window. Compare
  due-outcome coverage without claiming the backlog is solved from one sample.

Rollback is an image/code rollback to the previous public commit if the new
transport or cancellation path regresses; no data migration or outcome-rule
reversal is involved. Inspect deployment health and logs before deciding.

State: **prepared locally; not yet published or deployed**.
