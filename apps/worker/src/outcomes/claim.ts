import { randomUUID } from 'node:crypto';
import { prisma, type Prisma } from '@launch-auditor/db';

/** Package 4b (review d17cd0c4): expiring ownership of one resolution attempt.
 *
 *  Overlapping sweepers (two containers during a deploy, the backfill beside the
 *  live loop) selected the same PENDING rows and wrote by `id` alone, so one
 *  attempt could overwrite another's terminal result or retry evidence. Now an
 *  attempt claims its row with one conditional UPDATE before any RPC, and every
 *  result write is conditional on that attempt's token, an unexpired lease and a
 *  still-PENDING row. A crashed owner's claim simply expires. */

/** Pure: rows no live attempt owns — never claimed, released, or lease expired. */
export function unclaimedWhere(now: Date): Prisma.OutcomeWhereInput {
  return { OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }] };
}

/** Pure: the row as long as this attempt still owns it and it is unresolved. */
export function ownedWhere(id: string, token: string, now: Date): Prisma.OutcomeWhereInput {
  return { id, status: 'PENDING', claimToken: token, claimExpiresAt: { gt: now } };
}

export function newClaimToken(): string {
  return randomUUID();
}

/** Obtain database time only after acquiring the row lock. A timestamp captured
 * before a contended UPDATE can otherwise authorize a write after lease expiry. */
async function withLockedRow<T>(
  id: string,
  update: (tx: Prisma.TransactionClient, dbNow: Date) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM outcomes WHERE id = ${id} FOR UPDATE`;
    const [clock] = await tx.$queryRaw<Array<{ dbNow: Date }>>`SELECT clock_timestamp() AS "dbNow"`;
    if (!clock) throw new Error('database clock unavailable for outcome claim');
    return update(tx, clock.dbNow);
  }, { timeout: 30_000 });
}

/** Claim one row for `leaseMs`. `selection` is the sweep's own filter, so a row
 *  another sweeper has since deferred (backoff stamp) or graded is not claimed
 *  again from a stale read. One statement: under concurrent claims Postgres
 *  re-checks the WHERE on the row it locked, so exactly one claimant sees count 1. */
export async function claimRow(
  id: string,
  token: string,
  selection: Prisma.OutcomeWhereInput,
  leaseMs: number,
): Promise<boolean> {
  return withLockedRow(id, async (tx, dbNow) => {
    const r = await tx.outcome.updateMany({
      where: { AND: [selection, { id, status: 'PENDING' }, unclaimedWhere(dbNow)] },
      data: { claimToken: token, claimExpiresAt: new Date(dbNow.getTime() + leaseMs) },
    });
    return r.count === 1;
  });
}

/** Write this attempt's result and release the claim. False when the attempt no
 *  longer owns the row (lease expired, reclaimed or graded elsewhere): nothing
 *  was written and the result must not be counted. */
export async function writeOwned(
  id: string,
  token: string,
  data: Prisma.OutcomeUpdateManyMutationInput,
): Promise<boolean> {
  return withLockedRow(id, async (tx, dbNow) => {
    const r = await tx.outcome.updateMany({
      where: ownedWhere(id, token, dbNow),
      data: { ...data, claimToken: null, claimExpiresAt: null },
    });
    return r.count === 1;
  });
}
