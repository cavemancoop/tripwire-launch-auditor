# Outcome-writer cutover for Package 4b

`OUTCOMES_ENABLED=0` stops only the periodic outcome-resolution loop in the
worker. The default is enabled. This gate prepares a safe deployment of
expiring row claims: the old worker writes outcome rows by ID and can ignore a
claim held by a newer worker. A local PostgreSQL 16 race test reproduced an
old writer changing a claimed row and overwriting a terminal result. The
claim-capable worker must never resolve outcomes alongside an old writer.

Before deploying claims:

1. Deploy this bridge release with its default enabled setting. Confirm the
   bridge worker is healthy and all older worker deployments have stopped.
2. Set `OUTCOMES_ENABLED=0` on the worker. Wait for the new deployment to be
   healthy; confirm its `resolution loop disabled` log line and that no older
   enabled worker process or separate outcome writer is running. Inventory the
   manual `outcomes-run.ts` entry point, `backfill/run.ts`, and the
   `reset-stale-outcomes.ts` maintenance writer; the startup gate does not
   disable these scripts. Record the
   pause time and due-backlog totals. Watcher, feature, commit and scorer loops
   remain active.
3. Deploy a separately reviewed claim-capable release while the flag stays 0.
   It must retain the gate. Confirm the additive migration applies at worker
   startup and the outcome resolver is still disabled.
4. After every old outcome writer has stopped, set `OUTCOMES_ENABLED=1`.
   Observe the first sweeps alongside watcher, T+10m and commit calls for
   cross-work cancellation, duplicate writes, core-path errors and backlog
   growth.

On a regression, disable outcomes first and wait for the claim-capable
resolver to stop before rolling back to the bridge image. Do not overlap the
two writer versions during rollback. Record the running deployment IDs and
database state before correcting any affected rows.

The release operator must verify Railway's actual replacement sequence and
replica state at each step. A successful deployment status alone does not
prove an older outcome writer is gone. The claim migration's lock/WAL effect
on the populated production table also needs a separate check. PostgreSQL 16
[documents](https://www.postgresql.org/docs/16/sql-altertable.html) that these
two nullable columns without defaults do not rewrite existing rows, but the
`ALTER TABLE` requires an `ACCESS EXCLUSIVE` lock. A disposable 250,000-row,
72 MB table kept its relfilenode and heap size; the ALTER took 7.968 ms and
generated 1,080 bytes of WAL. Production lock wait time remains unknown until
the migration runs, so watch startup logs and core-path availability.
