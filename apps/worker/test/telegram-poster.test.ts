import { describe, expect, it, vi } from 'vitest';
import {
  formatTelegramMessage,
  postQualifiedLaunches,
  type TelegramCandidateRow,
} from '../src/telegram/poster';

const ROW: TelegramCandidateRow = {
  id: 'r1',
  tokenAddress: '0xabc0000000000000000000000000000000000d',
  reportHash: `0x${'11'.repeat(32)}`,
  pInsiderExit24h: 0.42,
  pDrawdown80_24h: 0.1,
  pTradingAlive24h: 0.9,
  txHash: '0xdeadbeef',
};

describe('formatTelegramMessage', () => {
  it('includes the token, probabilities, and a Blockscout proof link', () => {
    const msg = formatTelegramMessage(ROW, 4663);
    expect(msg).toContain(ROW.tokenAddress);
    expect(msg).toContain('42%');
    expect(msg).toContain('10%');
    expect(msg).toContain('90%');
    expect(msg).toContain(`/tx/${ROW.txHash}`);
    expect(msg).toContain(ROW.reportHash);
  });

  it('says proof is pending when there is no tx hash yet', () => {
    const msg = formatTelegramMessage({ ...ROW, txHash: null }, 4663);
    expect(msg).toContain('pending next commit batch');
  });
});

describe('postQualifiedLaunches', () => {
  it('posts each candidate and marks it posted', async () => {
    const send = vi.fn(async () => {});
    const markPosted = vi.fn(async () => {});
    const result = await postQualifiedLaunches({
      chainId: 4663,
      send,
      readCandidates: async () => [ROW],
      markPosted,
    });
    expect(result).toEqual({ candidates: 1, posted: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(markPosted).toHaveBeenCalledWith('r1');
  });

  it('leaves a failed send unmarked so it retries next sweep, and keeps processing the rest', async () => {
    const rowB = { ...ROW, id: 'r2', tokenAddress: '0xb00000000000000000000000000000000000b0' };
    const send = vi.fn(async (text: string) => {
      if (text.includes(ROW.tokenAddress)) throw new Error('telegram 500');
    });
    const markPosted = vi.fn(async () => {});
    const result = await postQualifiedLaunches({
      chainId: 4663,
      send,
      readCandidates: async () => [ROW, rowB],
      markPosted,
    });
    expect(result).toEqual({ candidates: 2, posted: 1, failed: 1 });
    expect(markPosted).toHaveBeenCalledTimes(1);
    expect(markPosted).toHaveBeenCalledWith('r2');
  });

  it('does nothing when there are no unposted qualified reports', async () => {
    const send = vi.fn(async () => {});
    const result = await postQualifiedLaunches({ chainId: 4663, send, readCandidates: async () => [] });
    expect(result).toEqual({ candidates: 0, posted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
