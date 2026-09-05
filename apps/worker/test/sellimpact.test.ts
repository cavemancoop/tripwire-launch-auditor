import { describe, expect, it, vi } from 'vitest';
import { quoteSellImpact } from '../src/watcher/sellimpact';

const QUOTER = '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94';
const TOKEN = '0x00000000000000000000000000000000000000ff';
const QUOTE = '0x0000000000000000000000000000000000000011'; // sorts below TOKEN

/** ABI-encode the quoter's (uint256 amountOut, uint256 gasEstimate) return */
const encodeReturn = (out: bigint): string =>
  `0x${out.toString(16).padStart(64, '0')}${(21000n).toString(16).padStart(64, '0')}`;

// totalSupply 1e24 => bulk (0.1%) = 1e21, spot (~1e-4%) = 1e18
const SUPPLY = 10n ** 24n;
const BULK = SUPPLY / 1000n;
const SPOT = BULK / 1000n;

// quoteSellImpact issues call(SPOT) then call(BULK) — invoked in that order.
function quoterClient(perAmount: (amt: bigint) => bigint | 'revert') {
  let n = 0;
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method !== 'eth_call') throw new Error(method);
      const amt = n++ === 0 ? SPOT : BULK;
      const r = perAmount(amt);
      if (r === 'revert') throw new Error('execution reverted');
      return encodeReturn(r);
    }),
  };
}

describe('quoteSellImpact', () => {
  it('reports ~0 bps when price scales linearly (deep pool)', async () => {
    const client = quoterClient((amt) => amt / 1000n); // out = amt/1000 exactly, no slippage
    const r = await quoteSellImpact({
      client: client as never,
      quoter: QUOTER,
      token: TOKEN,
      quote: QUOTE,
      fee: 3000,
      tickSpacing: 60,
      hooks: '0x0000000000000000000000000000000000000000',
      totalSupply: SUPPLY,
    });
    expect(r.sellSimOk).toBe(true);
    expect(r.sellImpactBps).toBe(0);
  });

  it('reports positive bps when the bulk sell gets a worse rate', async () => {
    const client = quoterClient((amt) => (amt === SPOT ? amt / 1000n : (amt / 1000n) * 90n / 100n)); // 10% worse
    const r = await quoteSellImpact({
      client: client as never,
      quoter: QUOTER,
      token: TOKEN,
      quote: QUOTE,
      fee: 3000,
      tickSpacing: 60,
      hooks: '0x0000000000000000000000000000000000000000',
      totalSupply: SUPPLY,
    });
    expect(r.sellImpactBps).toBe(1000); // 10% => 1000 bps
  });

  it('marks sell_sim_ok false when the quoter reverts', async () => {
    const client = quoterClient(() => 'revert');
    const r = await quoteSellImpact({
      client: client as never,
      quoter: QUOTER,
      token: TOKEN,
      quote: QUOTE,
      fee: 3000,
      tickSpacing: 60,
      hooks: '0x0000000000000000000000000000000000000000',
      totalSupply: SUPPLY,
    });
    expect(r.sellSimOk).toBe(false);
    expect(r.sellImpactBps).toBeNull();
  });
});
