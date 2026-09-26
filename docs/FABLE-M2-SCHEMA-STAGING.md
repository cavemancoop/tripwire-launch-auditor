# M2 schema staging

This release adds `POLICY_EXCLUDED` to the `OutcomeStatus` enum and updates the
generated Prisma client. It does not change any existing outcome row, enable a
new resolution policy, or run the historical correction. The worker applies
the additive migration at startup through `prisma migrate deploy`.

A local PostgreSQL 16 rehearsal showed that a client generated from the old
schema could still read rows with existing statuses after the enum was added.
Once a synthetic row was written with `POLICY_EXCLUDED`, that same client
failed with `Value 'POLICY_EXCLUDED' not found in enum 'OutcomeStatus'`.
The exact 18-migration tree for this release also applied cleanly with
`prisma migrate deploy` on a fresh PostgreSQL 16 database; a second run found
no pending migration. A client generated from this release's schema then
created and read a synthetic `POLICY_EXCLUDED` row successfully. These local
checks do not measure migration locks or WAL growth on production's populated
database.
Therefore, a later data correction must wait until every API and scorer read
path uses a compatible client. After the first new-status write, returning to
an old image requires a tested compensating data update or a roll-forward.

Before any production row correction, record the exact target predicate and
dry-run count; test backup, restore and a compensating update on a copy;
measure disk/WAL headroom; review whether the proposed policy and public
coverage language are approved. The schema migration alone satisfies none of
those data-write gates.
