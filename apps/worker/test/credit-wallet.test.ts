import { describe, expect, it } from 'vitest';
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  activationDecision,
  assertAllowedCall,
  deriveOrbioApiKey,
  describeKey,
  estimateBlockAt,
  orbioKeyMessage,
  type ActivationInputs,
} from '../src/metabolism/credit-wallet';

// Anvil/Hardhat default account #1 — a public, well-known test key, not a project secret.
const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ADDR = {
  credit: '0xe33322da1380e61e5ae5dfb21e7f62924c73004c',
  staking: '0xe0710011278bfb63e57c5f227e5980984b1eddca',
} as const;

describe('deriveOrbioApiKey — the wallet signature is the key', () => {
  it('matches the documented format and recovers to the wallet', async () => {
    const key = await deriveOrbioApiKey(PK, 0);
    expect(key).toMatch(/^sk-orb-0-[A-Za-z0-9+/]{87}=$/);
    expect(key.length).toBe(97); // same length as the live gas-wallet key
    const sig = `0x${Buffer.from(key.slice('sk-orb-0-'.length), 'base64').toString('hex')}` as const;
    expect(await recoverMessageAddress({ message: orbioKeyMessage(0), signature: sig })).toBe(privateKeyToAccount(PK).address);
  });

  it('is deterministic per epoch and changes on rotation', async () => {
    expect(await deriveOrbioApiKey(PK, 0)).toBe(await deriveOrbioApiKey(PK, 0));
    const rotated = await deriveOrbioApiKey(PK, 1);
    expect(rotated.startsWith('sk-orb-1-')).toBe(true);
    expect(rotated).not.toBe(await deriveOrbioApiKey(PK, 0));
  });

  it('logs never contain a usable key', async () => {
    const key = await deriveOrbioApiKey(PK, 0);
    const shown = describeKey(key);
    expect(shown).toMatch(/^sk-orb-0-.{4}… \(97 chars\)$/);
    expect(shown.length).toBeLessThan(30);
  });
});

describe('assertAllowedCall — the agent wallet cannot move tokens', () => {
  it('allows only CREDIT.activate and Staking.claim', () => {
    expect(() => assertAllowedCall(ADDR.credit, 'activate', ADDR)).not.toThrow();
    expect(() => assertAllowedCall(ADDR.staking.toUpperCase().replace('0X', '0x'), 'claim', ADDR)).not.toThrow();
  });

  it.each([
    [ADDR.credit, 'transfer'],
    [ADDR.credit, 'approve'],
    [ADDR.credit, 'transferFrom'],
    [ADDR.staking, 'unstake'],
    [ADDR.staking, 'unstakeAll'],
    [ADDR.staking, 'activate'],
    ['0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3', 'transfer'], // ORBIO
    ['0x6951ffd32630b05e06f50062aea801625a58ebc0', 'buy'], // Exchange
  ])('refuses %s.%s', (to, fn) => {
    expect(() => assertAllowedCall(to, fn, ADDR)).toThrow(/may only call CREDIT.activate and Staking.claim/);
  });

  it('refuses claim when no staking address is configured', () => {
    expect(() => assertAllowedCall(ADDR.staking, 'claim', { credit: ADDR.credit })).toThrow();
  });
});

describe('activationDecision', () => {
  const base: ActivationInputs = {
    apiBalanceUsd: 0,
    creditHeldUsd: 20,
    lowWaterUsd: 2,
    chunkUsd: 5,
    activatedTodayUsd: 0,
    dailyCapUsd: 5,
    pending: false,
  };
  const d = (over: Partial<ActivationInputs>) => activationDecision({ ...base, ...over });

  it('activates one chunk when below low-water with CREDIT held', () => {
    expect(d({})).toMatchObject({ activate: true, amountUsd: 5 });
  });
  it('never more than what is held', () => {
    expect(d({ creditHeldUsd: 1.2345678 })).toMatchObject({ activate: true, amountUsd: 1.234567 });
  });
  it('never more than the rest of the daily cap', () => {
    expect(d({ activatedTodayUsd: 3.5 })).toMatchObject({ activate: true, amountUsd: 1.5 });
    expect(d({ activatedTodayUsd: 5 })).toMatchObject({ activate: false });
  });
  it('waits while a previous activation is pending', () => {
    expect(d({ pending: true })).toMatchObject({ activate: false });
  });
  it('does nothing above low-water or with no CREDIT', () => {
    expect(d({ apiBalanceUsd: 2 })).toMatchObject({ activate: false });
    expect(d({ creditHeldUsd: 0 })).toMatchObject({ activate: false });
  });
});

describe('estimateBlockAt', () => {
  const head = { number: 1_000_000n, timestamp: 1_000_000n };
  const ref = { number: 990_000n, timestamp: 995_000n }; // 2 blocks/sec
  it('interpolates backwards and never lands after the target', () => {
    const b = estimateBlockAt(900_000, head, ref);
    expect(b).toBeLessThanOrEqual(1_000_000n - 200_000n);
    expect(b).toBeGreaterThan(1_000_000n - 210_000n);
  });
  it('returns head for a target in the future', () => {
    expect(estimateBlockAt(2_000_000, head, ref)).toBe(1_000_000n);
  });
});
