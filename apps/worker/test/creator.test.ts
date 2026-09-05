import { describe, expect, it, vi } from 'vitest';
import { firstTxBlock } from '../src/watcher/creator';

const CREATOR = '0x2222222222222222222222222222222222222222';

/** nonce is 0 below `firstBlock`, then 1+ from `firstBlock` on */
function nonceClient(firstBlock: bigint) {
  return {
    getTransactionCount: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
      blockNumber >= firstBlock ? 5 : 0,
    ),
  };
}

describe('firstTxBlock (nonce binary search)', () => {
  it('finds the exact block the creator first transacted', async () => {
    const client = nonceClient(1_234_567n);
    const found = await firstTxBlock(client as never, CREATOR, 54_000_000n);
    expect(found).toBe(1_234_567n);
  });

  it('handles a creator active from genesis', async () => {
    const client = nonceClient(0n);
    expect(await firstTxBlock(client as never, CREATOR, 100n)).toBe(0n);
  });

  it('returns null when the creator has no prior transactions (relayed launch)', async () => {
    const client = {
      getTransactionCount: vi.fn(async () => 0),
    };
    expect(await firstTxBlock(client as never, CREATOR, 54_000_000n)).toBeNull();
  });

  it('uses ~log2(range) calls, not a linear scan', async () => {
    const client = nonceClient(9_000_000n);
    await firstTxBlock(client as never, CREATOR, 54_000_000n);
    // 1 (nonce-at-launch) + ceil(log2(54e6)) ≈ 27
    expect(client.getTransactionCount.mock.calls.length).toBeLessThan(35);
  });
});
