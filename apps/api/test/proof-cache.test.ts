import { describe, expect, it, vi } from 'vitest';
import { memoizeProofReader, ProofCacheBusyError } from '../src/proof-cache';

const HASH = `0x${'a'.repeat(64)}`;

describe('proof reader cache', () => {
  it('coalesces concurrent readers and reuses a confirmed proof until its TTL', async () => {
    let release!: (row: { reportHash: string; committed: true; proofAvailable: true; onChainConfirmed: true }) => void;
    const reader = vi.fn(() => new Promise<{
      reportHash: string; committed: true; proofAvailable: true; onChainConfirmed: true;
    }>((resolve) => { release = resolve; }));
    let time = 0;
    const cached = memoizeProofReader(reader, { now: () => time, confirmedTtlMs: 60_000 });
    const first = cached(HASH);
    const second = cached(HASH.toUpperCase());
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    release({ reportHash: HASH, committed: true, proofAvailable: true, onChainConfirmed: true });
    expect(await first).toEqual(await second);
    time = 59_999;
    await cached(HASH);
    expect(reader).toHaveBeenCalledTimes(1);
    time = 60_000;
    void cached(HASH);
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
  });

  it('quickly refreshes missing and RPC-unknown results and evicts rejected reads', async () => {
    let time = 0;
    const reader = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ reportHash: HASH, committed: true, onChainConfirmed: null })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ reportHash: HASH, committed: true, onChainConfirmed: true });
    const cached = memoizeProofReader(reader, { now: () => time, otherTtlMs: 5_000 });
    expect(await cached(HASH)).toBeNull();
    time = 4_999;
    expect(await cached(HASH)).toBeNull();
    expect(reader).toHaveBeenCalledTimes(1);
    time = 5_000;
    expect((await cached(HASH))?.onChainConfirmed).toBeNull();
    time = 10_000;
    await expect(cached(HASH)).rejects.toThrow('db down');
    expect((await cached(HASH))?.onChainConfirmed).toBe(true);
    expect(reader).toHaveBeenCalledTimes(4);
  });

  it('bounds entries under a walk across distinct hashes', async () => {
    const reader = vi.fn(async (hash: string) => ({ reportHash: hash, committed: true, proofAvailable: true, onChainConfirmed: true }));
    const cached = memoizeProofReader(reader, { maxEntries: 2 });
    await cached('one');
    await cached('two');
    await cached('three');
    await cached('one');
    expect(reader).toHaveBeenCalledTimes(4);
  });

  it('refreshes pending state and does not retain a confirmed result after expiry', async () => {
    let time = 0;
    const reader = vi.fn()
      .mockResolvedValueOnce({ reportHash: HASH, committed: false })
      .mockResolvedValueOnce({ reportHash: HASH, committed: true, proofAvailable: true, onChainConfirmed: true })
      .mockResolvedValueOnce({ reportHash: HASH, committed: true, proofAvailable: true, onChainConfirmed: null });
    const cached = memoizeProofReader(reader, { now: () => time, otherTtlMs: 5_000, confirmedTtlMs: 60_000 });
    expect((await cached(HASH))?.committed).toBe(false);
    time = 5_000;
    expect((await cached(HASH))?.onChainConfirmed).toBe(true);
    time = 64_999;
    expect((await cached(HASH))?.onChainConfirmed).toBe(true);
    time = 65_000;
    expect((await cached(HASH))?.onChainConfirmed).toBeNull();
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it('keeps a slow read coalesced beyond 30 seconds, then starts TTL on settlement', async () => {
    let release!: (row: { reportHash: string; committed: true; proofAvailable: true; onChainConfirmed: true }) => void;
    const reader = vi.fn(() => new Promise<{
      reportHash: string; committed: true; proofAvailable: true; onChainConfirmed: true;
    }>((resolve) => { release = resolve; }));
    let time = 0;
    const cached = memoizeProofReader(reader, { now: () => time, confirmedTtlMs: 60_000 });
    const first = cached(HASH);
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    time = 30_000;
    const second = cached(HASH);
    expect(reader).toHaveBeenCalledTimes(1);
    release({ reportHash: HASH, committed: true, proofAvailable: true, onChainConfirmed: true });
    await expect(first).resolves.toEqual(await second);
    time = 89_999;
    await cached(HASH);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('refuses a new hash when all slots are in flight and keeps existing requests coalesced', async () => {
    const releases = new Map<string, (row: null) => void>();
    const reader = vi.fn((hash: string) => new Promise<null>((resolve) => { releases.set(hash, resolve); }));
    const cached = memoizeProofReader(reader, { maxEntries: 2 });
    const a = cached('a');
    const b = cached('b');
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
    await expect(cached('c')).rejects.toBeInstanceOf(ProofCacheBusyError);
    expect(cached('a')).toBe(a);
    expect(reader).toHaveBeenCalledTimes(2);
    releases.get('b')!(null);
    await b;
    const c = cached('c'); // settled B may now be evicted; pending A cannot
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(3));
    releases.get('a')!(null);
    releases.get('c')!(null);
    await Promise.all([a, c]);
  });
});
