import {
  GENESIS_HASH,
  prisma,
  verifyLifecycleRows,
  type LifecycleChainRow,
} from '@launch-auditor/db';
import Fastify, { type FastifyInstance } from 'fastify';

/** One `lifecycle_log` row as served by `GET /v1/lifecycle`. */
export interface LifecycleApiRow extends LifecycleChainRow {
  id: string;
  /** ISO — this is the value folded into `bodyHash`, not a display timestamp */
  at: string;
  signature: string | null;
  keyId: string | null;
}

export type LifecycleReader = (limit: number) => Promise<LifecycleApiRow[]>;

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** Default reader: the most-recent `limit` rows, returned oldest → newest. */
const prismaLifecycleReader: LifecycleReader = async (limit) => {
  const rows = await prisma.lifecycleLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows
    .map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      isSnapshot: r.isSnapshot,
      prevState: r.prevState,
      newState: r.newState,
      reason: r.reason,
      keyId: r.keyId,
      keyHashPrefix: r.keyHashPrefix,
      balanceUsd: r.balanceUsd,
      keyRemainingUsd: r.keyRemainingUsd,
      reserveUsd: r.reserveUsd,
      ledgerSpendUsd: r.ledgerSpendUsd,
      providerSpendUsd: r.providerSpendUsd,
      idsMismatch: r.idsMismatch,
      prevHash: r.prevHash,
      bodyHash: r.bodyHash,
      signature: r.signature,
    }))
    .reverse();
};

export interface BuildServerOptions {
  /** injectable for tests — defaults to a Prisma-backed reader */
  lifecycleReader?: LifecycleReader;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const readLifecycle = opts.lifecycleReader ?? prismaLifecycleReader;

  app.get('/health', async () => ({
    ok: true,
    service: 'launch-auditor-api',
  }));

  // spec §9 — free: the signed key-lifecycle log (spec §8). Each entry is
  // independently verifiable: `bodyHash` = keccak256(RFC-8785(body)),
  // `signature` = the agent key's EIP-191 personal_sign of `bodyHash`, and
  // `prevHash` folds the previous entry's `bodyHash` into a tamper-evident chain.
  app.get('/v1/lifecycle', async (req) => {
    const q = req.query as { limit?: string };
    const parsed = Number(q.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(parsed)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)))
      : DEFAULT_LIMIT;

    const entries = await readLifecycle(limit);
    const check = verifyLifecycleRows(entries);

    return {
      count: entries.length,
      limit,
      genesisHash: GENESIS_HASH,
      verified: check.linked,
      startsAtGenesis: check.startsAtGenesis,
      brokenAt: check.brokenAt,
      entries,
      verification: {
        body: 'keccak256(RFC8785({at,prevState,newState,reason,isSnapshot,keyHashPrefix,balanceUsd,keyRemainingUsd,reserveUsd,ledgerSpendUsd,providerSpendUsd,idsMismatch,prevHash}))',
        signature: 'agent key EIP-191 personal_sign of bodyHash (raw 32 bytes)',
        chain: 'entries[i].prevHash === entries[i-1].bodyHash; entries[0].prevHash === genesisHash',
      },
    };
  });

  return app;
}
