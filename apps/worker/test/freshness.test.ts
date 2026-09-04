import { describe, expect, it } from 'vitest';
import { FRESH_LAUNCH_WINDOW_BLOCKS, checkTokenFreshness } from '../src/watcher/freshness';

const TOKEN = '0x1111111111111111111111111111111111111111';

function fakeClient(opts: { codeAtCheckBlock?: `0x${string}` | undefined; throws?: boolean }) {
  return {
    getCode: async () => {
      if (opts.throws) throw new Error('missing trie node');
      return opts.codeAtCheckBlock;
    },
  };
}

describe('checkTokenFreshness', () => {
  it('is fresh when the token has no code at the window start (just deployed)', async () => {
    const client = fakeClient({ codeAtCheckBlock: undefined });
    const r = await checkTokenFreshness(client, TOKEN, 100_000n);
    expect(r.reason).toBe('fresh');
    expect(r.isFreshLaunch).toBe(true);
    expect(r.checkedAtBlock).toBe(100_000n - FRESH_LAUNCH_WINDOW_BLOCKS);
  });

  it('is fresh when getCode returns bare "0x"', async () => {
    const client = fakeClient({ codeAtCheckBlock: '0x' });
    const r = await checkTokenFreshness(client, TOKEN, 100_000n);
    expect(r.reason).toBe('fresh');
  });

  it('is preexisting when the token already had code at the window start', async () => {
    const client = fakeClient({ codeAtCheckBlock: '0x6080604052' });
    const r = await checkTokenFreshness(client, TOKEN, 100_000n);
    expect(r.reason).toBe('preexisting');
    expect(r.isFreshLaunch).toBe(false);
  });

  it('checks near block 0 when the pool is close to genesis', async () => {
    const client = fakeClient({ codeAtCheckBlock: undefined });
    const r = await checkTokenFreshness(client, TOKEN, 10n);
    expect(r.checkedAtBlock).toBe(0n);
  });

  it('is inconclusive (and defaults fresh) when the RPC can\'t answer for that block', async () => {
    const client = fakeClient({ throws: true });
    const r = await checkTokenFreshness(client, TOKEN, 100_000n);
    expect(r.reason).toBe('inconclusive');
    expect(r.isFreshLaunch).toBe(true);
  });
});
