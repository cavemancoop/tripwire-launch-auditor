import { describe, expect, it } from 'vitest';
import { FRESH_LAUNCH_WINDOW_BLOCKS, checkTokenFreshness } from '../src/watcher/freshness';

const TOKEN = '0x1111111111111111111111111111111111111111';

function fakeBlockscout(opts: {
  creationTxHash?: string | null;
  creationBlock?: number | null;
  throwOnAddress?: boolean;
  throwOnTx?: boolean;
}) {
  return {
    getAddress: async () => {
      if (opts.throwOnAddress) throw new Error('blockscout down');
      return { hash: TOKEN, is_contract: true, creation_transaction_hash: opts.creationTxHash ?? null };
    },
    getTransaction: async () => {
      if (opts.throwOnTx) throw new Error('blockscout down');
      return { hash: 'x', block_number: opts.creationBlock ?? null, from: { hash: '0x0' }, to: null };
    },
  };
}

describe('checkTokenFreshness', () => {
  it('is fresh when the token was created at/near the pool block', async () => {
    const bs = fakeBlockscout({ creationTxHash: '0xabc', creationBlock: 1000 });
    const r = await checkTokenFreshness(bs, TOKEN, 1002n);
    expect(r.reason).toBe('fresh');
    expect(r.isFreshLaunch).toBe(true);
    expect(r.ageBlocksAtPool).toBe(2n);
  });

  it('is preexisting when the token predates the pool by more than the fresh window', async () => {
    const bs = fakeBlockscout({ creationTxHash: '0xabc', creationBlock: 1000 });
    const poolBlock = 1000n + FRESH_LAUNCH_WINDOW_BLOCKS + 1n;
    const r = await checkTokenFreshness(bs, TOKEN, poolBlock);
    expect(r.reason).toBe('preexisting');
    expect(r.isFreshLaunch).toBe(false);
  });

  it('is right at the window boundary: exactly the window is still fresh', async () => {
    const bs = fakeBlockscout({ creationTxHash: '0xabc', creationBlock: 1000 });
    const poolBlock = 1000n + FRESH_LAUNCH_WINDOW_BLOCKS;
    const r = await checkTokenFreshness(bs, TOKEN, poolBlock);
    expect(r.reason).toBe('fresh');
  });

  it('is inconclusive (and defaults fresh) with no creation tx on record', async () => {
    const bs = fakeBlockscout({ creationTxHash: null });
    const r = await checkTokenFreshness(bs, TOKEN, 1000n);
    expect(r.reason).toBe('inconclusive');
    expect(r.isFreshLaunch).toBe(true);
  });

  it('is inconclusive when the creation tx has no block yet', async () => {
    const bs = fakeBlockscout({ creationTxHash: '0xabc', creationBlock: null });
    const r = await checkTokenFreshness(bs, TOKEN, 1000n);
    expect(r.reason).toBe('inconclusive');
  });

  it('is inconclusive when Blockscout errors', async () => {
    const bs = fakeBlockscout({ throwOnAddress: true });
    const r = await checkTokenFreshness(bs, TOKEN, 1000n);
    expect(r.reason).toBe('inconclusive');
    expect(r.isFreshLaunch).toBe(true);
  });
});
