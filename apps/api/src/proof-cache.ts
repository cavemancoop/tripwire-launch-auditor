import type { ProofReader } from './server';

export class ProofCacheBusyError extends Error {
  constructor() {
    super('proof reader is busy; retry shortly');
    this.name = 'ProofCacheBusyError';
  }
}

/** A confirmed proof is immutable for the short cache window. Pending, missing
 * or temporarily unconfirmed responses expire quickly so a new commitment or
 * a recovered RPC is visible without a process restart. */
export function memoizeProofReader(
  reader: ProofReader,
  opts: { now?: () => number; maxEntries?: number; confirmedTtlMs?: number; otherTtlMs?: number } = {},
): ProofReader {
  const now = opts.now ?? Date.now;
  const maxEntries = Math.max(1, opts.maxEntries ?? 256);
  const confirmedTtlMs = opts.confirmedTtlMs ?? 60_000;
  const otherTtlMs = opts.otherTtlMs ?? 5_000;
  const cache = new Map<string, { promise: ReturnType<ProofReader>; expiresAt: number; settled: boolean }>();

  return (hash) => {
    const key = hash.toLowerCase();
    const cached = cache.get(key);
    if (cached && (!cached.settled || cached.expiresAt > now())) {
      // Recently used entries survive bounded eviction longer.
      cache.delete(key);
      cache.set(key, cached);
      return cached.promise;
    }
    cache.delete(key);

    // Reclaim only settled entries. Evicting a pending promise would leave its
    // DB/RPC read running while a second hit for the same hash starts another.
    for (const [oldKey, old] of cache) {
      if (cache.size < maxEntries) break;
      if (old.settled) cache.delete(oldKey);
    }
    if (cache.size >= maxEntries) return Promise.reject(new ProofCacheBusyError());

    const entry = { promise: Promise.resolve(null) as ReturnType<ProofReader>, expiresAt: 0, settled: false };
    const pending = Promise.resolve().then(() => reader(key));
    entry.promise = pending;
    cache.set(key, entry);

    void pending.then(
      (row) => {
        if (cache.get(key) !== entry) return;
        const confirmed = row?.committed && row.proofAvailable && row.onChainConfirmed === true;
        entry.settled = true;
        entry.expiresAt = now() + (confirmed ? confirmedTtlMs : otherTtlMs);
      },
      () => {
        if (cache.get(key) === entry) cache.delete(key);
      },
    );
    return pending;
  };
}
