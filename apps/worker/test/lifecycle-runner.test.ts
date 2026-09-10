import { describe, expect, it } from 'vitest';
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { GENESIS_HASH, verifyLifecycleRows, type LifecycleChainRow } from '@launch-auditor/db';
import {
  decideLifecycle,
  LifecycleLogWriter,
  type LifecycleConfig,
  type LifecyclePersistRecord,
  type LifecycleReading,
} from '../src/metabolism/lifecycle-runner';
import { nextState } from '../src/metabolism/state';

const CFG: LifecycleConfig = {
  reserveUsd: 3,
  lowWaterUsd: 6,
  hygieneRotateDays: 7,
  idsToleranceUsd: 0.01,
};

const base: LifecycleReading = {
  state: 'ACTIVE',
  halted: false,
  balanceUsd: 20,
  hasKey: true,
  holdSecret: true,
  keyAgeDays: 1,
  ledgerSpendUsd: 0,
  providerSpendUsd: 0,
};
const read = (over: Partial<LifecycleReading>): LifecycleReading => ({ ...base, ...over });

describe('decideLifecycle — adapted §8 machine (2026-09-09 decisions)', () => {
  it('NO_KEY + balance above reserve → mint → ACTIVE', () => {
    const d = decideLifecycle(read({ state: 'NO_KEY', hasKey: false, holdSecret: false }), CFG);
    expect(d).toMatchObject({ kind: 'transition', to: 'ACTIVE', event: 'KEY_CLAIMED', mint: true });
  });

  it('NO_KEY + balance at/below reserve → STARVED (no mint)', () => {
    const d = decideLifecycle(read({ state: 'NO_KEY', hasKey: false, balanceUsd: 3 }), CFG);
    expect(d).toMatchObject({ kind: 'transition', to: 'STARVED', event: 'NO_CREDITS' });
  });

  it('NO_KEY + halted → steady (awaits manual re-auth)', () => {
    const d = decideLifecycle(read({ state: 'NO_KEY', hasKey: false, halted: true }), CFG);
    expect(d).toEqual({ kind: 'steady', state: 'NO_KEY', reason: expect.stringContaining('halted') });
  });

  it('ACTIVE healthy → steady ACTIVE', () => {
    expect(decideLifecycle(read({}), CFG)).toMatchObject({ kind: 'steady', state: 'ACTIVE' });
  });

  it('ACTIVE + balance below low-water but above reserve → DRAINING', () => {
    const d = decideLifecycle(read({ balanceUsd: 5 }), CFG);
    expect(d).toMatchObject({ kind: 'transition', from: 'ACTIVE', to: 'DRAINING', event: 'LOW_BALANCE' });
  });

  it('DRAINING + balance back above low-water → ACTIVE', () => {
    const d = decideLifecycle(read({ state: 'DRAINING', balanceUsd: 12 }), CFG);
    expect(d).toMatchObject({ kind: 'transition', from: 'DRAINING', to: 'ACTIVE', event: 'STATUS_OK' });
  });

  it('DRAINING + still low → steady DRAINING', () => {
    expect(decideLifecycle(read({ state: 'DRAINING', balanceUsd: 5 }), CFG)).toMatchObject({
      kind: 'steady',
      state: 'DRAINING',
    });
  });

  it('ACTIVE + balance ≤ reserve → STARVED, never ROTATING (no drain-then-rotate)', () => {
    const d = decideLifecycle(read({ balanceUsd: 2.5 }), CFG);
    expect(d).toMatchObject({ kind: 'transition', to: 'STARVED', event: 'NO_CREDITS' });
  });

  it('ACTIVE + key age ≥ hygiene days → rotate', () => {
    const d = decideLifecycle(read({ keyAgeDays: 7.2 }), CFG);
    expect(d).toEqual({ kind: 'rotate', from: 'ACTIVE', reason: expect.stringContaining('hygiene') });
  });

  it('ACTIVE + key exists at provider but we do not hold the secret → revoke', () => {
    const d = decideLifecycle(read({ holdSecret: false }), CFG);
    expect(d).toMatchObject({ kind: 'revoke', from: 'ACTIVE' });
  });

  it('ACTIVE + provider reports no key → NO_KEY', () => {
    const d = decideLifecycle(read({ hasKey: false, holdSecret: false }), CFG);
    expect(d).toMatchObject({ kind: 'transition', from: 'ACTIVE', to: 'NO_KEY', event: 'REVOKED' });
  });

  it('IDS mismatch preempts everything, even a hygiene-due key', () => {
    const d = decideLifecycle(read({ keyAgeDays: 30, ledgerSpendUsd: 1.0, providerSpendUsd: 2.5 }), CFG);
    expect(d).toMatchObject({ kind: 'revoke', from: 'ACTIVE' });
  });

  it('STARVED + balance recovers, key still valid → ACTIVE without minting', () => {
    const d = decideLifecycle(read({ state: 'STARVED', balanceUsd: 10 }), CFG);
    expect(d).toMatchObject({ kind: 'transition', to: 'ACTIVE', event: 'KEY_CLAIMED' });
    expect((d as { mint?: boolean }).mint).toBeUndefined();
  });

  it('STARVED + balance recovers, no key → mint → ACTIVE', () => {
    const d = decideLifecycle(read({ state: 'STARVED', balanceUsd: 10, hasKey: false, holdSecret: false }), CFG);
    expect(d).toMatchObject({ kind: 'transition', to: 'ACTIVE', mint: true });
  });

  it('STARVED + still below reserve → steady STARVED', () => {
    expect(decideLifecycle(read({ state: 'STARVED', balanceUsd: 1 }), CFG)).toMatchObject({
      kind: 'steady',
      state: 'STARVED',
    });
  });

  it('ROTATING resumes to ACTIVE with a mint', () => {
    expect(decideLifecycle(read({ state: 'ROTATING' }), CFG)).toMatchObject({
      kind: 'transition',
      to: 'ACTIVE',
      mint: true,
    });
  });

  it('REVOKING resumes to NO_KEY', () => {
    expect(decideLifecycle(read({ state: 'REVOKING' }), CFG)).toMatchObject({
      kind: 'transition',
      to: 'NO_KEY',
      event: 'REVOKED',
    });
  });
});

describe('every emitted (from,event,to) is a real edge of state.ts', () => {
  // the runner drives state.ts's machine; enumerate the readings that produce a
  // `transition` and assert nextState agrees. `REVOKED` from ACTIVE/DRAINING is
  // the one documented bypass (provider lost the key out-of-band).
  const readings: LifecycleReading[] = [
    read({ state: 'NO_KEY', hasKey: false, holdSecret: false }), // -> ACTIVE / KEY_CLAIMED
    read({ state: 'NO_KEY', hasKey: false, balanceUsd: 1 }), // -> STARVED / NO_CREDITS
    read({ balanceUsd: 5 }), // ACTIVE -> DRAINING / LOW_BALANCE
    read({ state: 'DRAINING', balanceUsd: 12 }), // -> ACTIVE / STATUS_OK
    read({ balanceUsd: 2 }), // ACTIVE -> STARVED / NO_CREDITS
    read({ state: 'DRAINING', balanceUsd: 2 }), // -> STARVED / NO_CREDITS
    read({ state: 'STARVED', balanceUsd: 10 }), // -> ACTIVE / KEY_CLAIMED
    read({ state: 'ROTATING' }), // -> ACTIVE / KEY_CLAIMED
    read({ state: 'REVOKING' }), // -> NO_KEY / REVOKED
  ];

  for (const r of readings) {
    const d = decideLifecycle(r, CFG);
    if (d.kind !== 'transition') continue;
    it(`${d.from} --${d.event}--> ${d.to}`, () => {
      expect(nextState(d.from, d.event)?.state).toBe(d.to);
    });
  }

  it('rotate expands to ACTIVE--HYGIENE_DUE-->ROTATING--KEY_CLAIMED-->ACTIVE', () => {
    expect(nextState('ACTIVE', 'HYGIENE_DUE')?.state).toBe('ROTATING');
    expect(nextState('ROTATING', 'KEY_CLAIMED')?.state).toBe('ACTIVE');
  });

  it('revoke expands to *--IDS_MISMATCH-->REVOKING--REVOKED-->NO_KEY', () => {
    expect(nextState('ACTIVE', 'IDS_MISMATCH')?.state).toBe('REVOKING');
    expect(nextState('REVOKING', 'REVOKED')?.state).toBe('NO_KEY');
  });
});

describe('LifecycleLogWriter — hash chain + agent signature', () => {
  const AGENT = `0x${'11'.repeat(32)}` as const;
  const agentAddr = privateKeyToAccount(AGENT).address;

  const toChainRow = (rec: LifecyclePersistRecord): LifecycleChainRow => ({
    at: rec.createdAt.toISOString(),
    prevState: rec.prevState,
    newState: rec.newState,
    reason: rec.reason,
    isSnapshot: rec.isSnapshot,
    keyHashPrefix: rec.keyHashPrefix,
    balanceUsd: rec.balanceUsd,
    keyRemainingUsd: rec.keyRemainingUsd,
    reserveUsd: rec.reserveUsd,
    ledgerSpendUsd: rec.ledgerSpendUsd,
    providerSpendUsd: rec.providerSpendUsd,
    idsMismatch: rec.idsMismatch,
    prevHash: rec.prevHash,
    bodyHash: rec.bodyHash,
  });

  async function writeChain(seed = GENESIS_HASH) {
    const recs: LifecyclePersistRecord[] = [];
    const writer = new LifecycleLogWriter(AGENT, seed, async (rec) => {
      recs.push(rec);
      return { id: String(recs.length) };
    });
    await writer.append({ isSnapshot: false, prevState: null, newState: 'NO_KEY', reason: 'instance start', balanceUsd: 20, reserveUsd: 3 });
    await writer.append({ isSnapshot: false, prevState: 'NO_KEY', newState: 'ACTIVE', reason: 'minted key', balanceUsd: 20, reserveUsd: 3, keyHashPrefix: 'sk-orbio-AAA' });
    await writer.append({ isSnapshot: true, prevState: 'ACTIVE', newState: 'ACTIVE', reason: 'snapshot after → ACTIVE', balanceUsd: 20, reserveUsd: 3 });
    return { recs, writer };
  }

  it('links every row and verifies from genesis', async () => {
    const { recs, writer } = await writeChain();
    const rows = recs.map(toChainRow);
    const check = verifyLifecycleRows(rows);
    expect(check).toMatchObject({ linked: true, startsAtGenesis: true, length: 3, brokenAt: null });
    expect(writer.head).toBe(rows[2]!.bodyHash);
    expect(recs[0]!.prevHash).toBe(GENESIS_HASH);
    expect(recs[1]!.prevHash).toBe(recs[0]!.bodyHash);
  });

  it('each signature recovers to the agent address', async () => {
    const { recs } = await writeChain();
    for (const rec of recs) {
      const signer = await recoverMessageAddress({
        message: { raw: rec.bodyHash as `0x${string}` },
        signature: rec.signature as `0x${string}`,
      });
      expect(signer).toBe(agentAddr);
    }
  });

  it('detects a tampered row', async () => {
    const { recs } = await writeChain();
    const rows = recs.map(toChainRow);
    rows[1] = { ...rows[1]!, reason: 'tampered' };
    const check = verifyLifecycleRows(rows);
    expect(check.linked).toBe(false);
    expect(check.brokenAt).toBe(1);
  });

  it('a window that does not start at genesis still links internally', async () => {
    const seed = `0x${'ab'.repeat(32)}` as const;
    const { recs } = await writeChain(seed);
    const check = verifyLifecycleRows(recs.map(toChainRow));
    expect(check.linked).toBe(true);
    expect(check.startsAtGenesis).toBe(false);
  });
});
