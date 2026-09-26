import { describe, expect, it, vi } from 'vitest';
import { quoteExactInSingle } from '../src/outcomes/quote';
import { quoteDecimals } from '../src/outcomes/resolve';
import { resolveSellImpaired } from '../src/outcomes/resolve-sell-impaired';
import { resolveSurvival } from '../src/outcomes/resolve-survival';
import {
  POOL_KEY,
  QUOTA_18_SEP,
  failingClient,
  named,
  resolverCtx,
  viemRpcError,
} from './fixtures/outcome-quota';

// Package 4a / F05: a provider failure is not a measurement. Before this package
// resolveSurvival turned the 18 Sep quota text (and any viem error whose first
// line is "HTTP request failed." / "The request took too long to respond.") into
// a reason the sweep's retry pattern did not match, so the row went UNRESOLVABLE
// for good; quote.ts reported it as a 'network' quote failure on the 24h clock.

describe('resolveSurvival — provider failures propagate, row failures stay UNRESOLVABLE', () => {
  it('the exact quota text propagates instead of becoming UNRESOLVABLE', async () => {
    const r = resolveSurvival(resolverCtx({ client: failingClient(new Error(QUOTA_18_SEP)) as never }));
    await expect(r).rejects.toThrow(QUOTA_18_SEP);
  });

  it('quota hidden below viem\'s first line propagates with its full message', async () => {
    const r = resolveSurvival(resolverCtx({ client: failingClient(viemRpcError(QUOTA_18_SEP)) as never }));
    await expect(r).rejects.toThrow(/Details: You've reached your monthly quota/);
  });

  it('a transport failure propagates', async () => {
    const r = resolveSurvival(resolverCtx({ client: failingClient(new Error('fetch failed')) as never }));
    await expect(r).rejects.toThrow('fetch failed');
  });

  it('an archive miss is still UNRESOLVABLE with the first-line reason (unchanged)', async () => {
    const r = await resolveSurvival(resolverCtx({ client: failingClient(new Error('missing trie node 0xab')) as never }));
    expect(r.status).toBe('UNRESOLVABLE');
    expect(r.value).toBeNull();
    expect(r.reason).toBe('could not scan the survival window: missing trie node 0xab');
  });
});

describe('quoteExactInSingle — quota propagates, other failures keep their classification', () => {
  const quote = (err: unknown) =>
    quoteExactInSingle({
      client: failingClient(err) as never,
      quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
      poolKey: POOL_KEY,
      zeroForOne: false,
      amountIn: 10n ** 12n,
      blockNumber: 100n,
    });

  it('quota (bare or inside viem details) is thrown, not returned as a quote failure', async () => {
    await expect(quote(new Error(QUOTA_18_SEP))).rejects.toThrow(QUOTA_18_SEP);
    await expect(quote(viemRpcError(QUOTA_18_SEP))).rejects.toThrow(/monthly quota/);
  });

  it('revert, archive and network are unchanged', async () => {
    expect(await quote(new Error('execution reverted'))).toMatchObject({ ok: false, error: 'revert' });
    expect(await quote(new Error('missing trie node 0xab'))).toMatchObject({ ok: false, error: 'archive' });
    expect(await quote(new Error('socket hang up'))).toMatchObject({ ok: false, error: 'network' });
    expect(await quote(named('TimeoutError', 'request timeout'))).toMatchObject({ ok: false, error: 'network' });
  });
});

describe('resolveSellImpaired — a quota outage is neither impaired nor unresolvable', () => {
  it('quota on the spot quote propagates', async () => {
    const r = resolveSellImpaired(
      resolverCtx({ label: 'SELL_IMPAIRED', poolKey: POOL_KEY, client: failingClient(viemRpcError(QUOTA_18_SEP)) as never }),
    );
    await expect(r).rejects.toThrow(/monthly quota/);
  });

  it('a revert on the spot quote is still UNRESOLVABLE (unchanged)', async () => {
    const r = await resolveSellImpaired(
      resolverCtx({ label: 'SELL_IMPAIRED', poolKey: POOL_KEY, client: failingClient(new Error('execution reverted')) as never }),
    );
    expect(r.status).toBe('UNRESOLVABLE');
    expect(r.value).toBeNull();
    expect(r.reason).toBe('spot sell quote revert at horizon block');
  });
});

describe('quoteDecimals — a provider failure does not poison the decimals cache', () => {
  it('quota propagates, and the next successful read returns the real decimals', async () => {
    const asset = '0x00000000000000000000000000000000000000a1';
    const down = { readContract: vi.fn(async () => { throw viemRpcError(QUOTA_18_SEP); }) };
    await expect(quoteDecimals(down as never, asset)).rejects.toThrow(/monthly quota/);
    const up = { readContract: vi.fn(async () => 6) };
    expect(await quoteDecimals(up as never, asset)).toBe(6);
  });

  it('a transport failure propagates too', async () => {
    const asset = '0x00000000000000000000000000000000000000a2';
    const down = { readContract: vi.fn(async () => { throw new Error('socket hang up'); }) };
    await expect(quoteDecimals(down as never, asset)).rejects.toThrow('socket hang up');
  });

  it('a token without decimals() still falls back to 18 and caches it (unchanged)', async () => {
    const asset = '0x00000000000000000000000000000000000000a3';
    const reverts = { readContract: vi.fn(async () => { throw new Error('execution reverted'); }) };
    expect(await quoteDecimals(reverts as never, asset)).toBe(18);
    const later = { readContract: vi.fn(async () => 6) };
    expect(await quoteDecimals(later as never, asset)).toBe(18);
    expect(later.readContract).not.toHaveBeenCalled();
  });
});
