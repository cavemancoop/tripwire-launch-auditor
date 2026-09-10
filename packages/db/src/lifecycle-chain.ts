/**
 * The tamper-evident hash chain behind `lifecycle_log` (spec §8 — "the signed
 * lifecycle log as evidence"). Kept here, next to the `LifecycleLog` model, so
 * the worker that writes rows and the API that serves them agree on one exact
 * canonicalisation. RFC 8785 canonical JSON of the body, keccak256 of that; each
 * row's `bodyHash` folds in the previous row's `bodyHash` via `prevHash`.
 */
import canonicalize from 'canonicalize';
import { keccak256, stringToHex, type Hex } from 'viem';

export const GENESIS_HASH: Hex = `0x${'00'.repeat(32)}`;

/** The signed body of one lifecycle row. Field set is frozen — changing it breaks every prior signature. */
export interface LifecycleBody {
  at: string; // ISO
  prevState: string | null;
  newState: string;
  reason: string;
  isSnapshot: boolean;
  keyHashPrefix: string | null;
  balanceUsd: number | null;
  keyRemainingUsd: number | null;
  reserveUsd: number | null;
  ledgerSpendUsd: number | null;
  providerSpendUsd: number | null;
  idsMismatch: boolean;
  prevHash: Hex;
}

export function lifecycleBodyHash(body: LifecycleBody): Hex {
  const s = canonicalize(body as object);
  if (s === undefined) throw new Error('canonicalize returned undefined');
  return keccak256(stringToHex(s));
}

/** A stored row as the verifier needs to see it (a superset of {@link LifecycleBody}). */
export interface LifecycleChainRow extends Omit<LifecycleBody, 'prevHash'> {
  prevHash: string | null;
  bodyHash: string | null;
}

export interface LifecycleChainCheck {
  /** every row's bodyHash recomputes AND its prevHash equals the previous row's bodyHash */
  linked: boolean;
  /** the first row's prevHash is the genesis hash (i.e. this is the whole chain, not a window) */
  startsAtGenesis: boolean;
  length: number;
  /** index of the first row that fails, or null */
  brokenAt: number | null;
}

function bodyOf(r: LifecycleChainRow, prevHash: Hex): LifecycleBody {
  return {
    at: r.at,
    prevState: r.prevState,
    newState: r.newState,
    reason: r.reason,
    isSnapshot: r.isSnapshot,
    keyHashPrefix: r.keyHashPrefix,
    balanceUsd: r.balanceUsd,
    keyRemainingUsd: r.keyRemainingUsd,
    reserveUsd: r.reserveUsd,
    ledgerSpendUsd: r.ledgerSpendUsd,
    providerSpendUsd: r.providerSpendUsd,
    idsMismatch: r.idsMismatch,
    prevHash,
  };
}

/** Verify a run of rows in ascending order. Works on a window (does not require the genesis row). */
export function verifyLifecycleRows(rows: LifecycleChainRow[]): LifecycleChainCheck {
  let linked = true;
  let brokenAt: number | null = null;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const prevHash = (r.prevHash ?? GENESIS_HASH) as Hex;
    const bodyOk = lifecycleBodyHash(bodyOf(r, prevHash)) === r.bodyHash;
    const linkOk = i === 0 ? true : r.prevHash === rows[i - 1]!.bodyHash;
    if (!bodyOk || !linkOk) {
      linked = false;
      if (brokenAt === null) brokenAt = i;
    }
  }
  return {
    linked,
    startsAtGenesis: rows.length === 0 || (rows[0]!.prevHash ?? GENESIS_HASH) === GENESIS_HASH,
    length: rows.length,
    brokenAt,
  };
}
