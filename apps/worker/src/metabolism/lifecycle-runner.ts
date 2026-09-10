/**
 * M5b-2 — the 60s Metabolism lifecycle runner (spec §8, adapted per the
 * 2026-09-09 CHANGELOG decisions).
 *
 * Every `METABOLISM_STATUS_POLL_SEC` seconds it polls `orbio_get_balance` +
 * `orbio_get_key_status`, computes the next transition with {@link decideLifecycle}
 * (a pure function driving `state.ts`'s machine), acts on it via the Orbio
 * wrappers, and appends a signed row to `lifecycle_log` for every transition and
 * one snapshot per tick ({@link LifecycleLogWriter}, hash-chained + agent-signed).
 *
 * Adaptations vs the pristine `state.ts` machine, all from the CHANGELOG:
 *  - a key holds no money; the account balance IS the quota. `claimSize` /
 *    `reserveR` are gone — the floor is a flat `RESERVE_USD`.
 *  - `balance − RESERVE_USD ≤ 0` → STARVED directly (NO rotate: a fresh key
 *    spends the same empty balance). Recovery: balance back above reserve → ACTIVE.
 *  - ROTATING is hygiene-only (key age ≥ `hygieneRotateDays`).
 *  - local `MetabolismSpend` sum vs `orbio_get_balance.spent.usd` mismatch →
 *    REVOKING → revoke_key → NO_KEY, then HALT (await a human `pnpm orbio:auth`).
 */
import { Prisma, prisma } from '@launch-auditor/db';
import type { Hex } from 'viem';
import { loadEnv } from '../env';
import {
  buildLifecycleEntry,
  GENESIS_HASH,
  signLifecycleEntry,
} from './lifecycle';
import {
  connectOrbio,
  orbioCreateKey,
  orbioGetBalance,
  orbioGetKeyStatus,
  orbioRevokeKey,
  type OrbioConnection,
} from './orbio-client';
import { reconcileIds, type IdsReconcile } from './ids-reconcile';
import { totalSpendUsd } from './spend-ledger';
import { nextState, type LifecycleEvent, type LifecycleState } from './state';
import {
  loadEncryptionKey,
  readOAuthBlob,
  tokenStorePath,
  updateOAuthBlob,
} from './token-store';

/* ────────────────────────── pure decision ────────────────────────── */

export interface LifecycleConfig {
  reserveUsd: number;
  lowWaterUsd: number;
  hygieneRotateDays: number;
  idsToleranceUsd: number;
  idsGraceUsd: number;
}

export interface LifecycleReading {
  state: LifecycleState;
  /** set after an IDS-triggered revoke; blocks auto-mint until a human re-auths */
  halted: boolean;
  balanceUsd: number;
  /** orbio_get_key_status.hasKey */
  hasKey: boolean;
  /** we hold this key's secret in the encrypted store (else it is unusable) */
  holdSecret: boolean;
  /** age of the current key in days, or null when there is no key */
  keyAgeDays: number | null;
  /** Σ MetabolismSpend.costUsd (local ledger) — kept for the lifecycle_log row */
  ledgerSpendUsd: number;
  /** orbio_get_balance.spent.usd (provider) — kept for the lifecycle_log row */
  providerSpendUsd: number;
  /** M5b-3: per-key baseline reconcile of the two above */
  ids: IdsReconcile;
}

export type LifecycleDecision =
  | { kind: 'steady'; state: LifecycleState; reason: string }
  | {
      kind: 'transition';
      from: LifecycleState;
      to: LifecycleState;
      event: LifecycleEvent;
      reason: string;
      /** mint a fresh gateway key before recording the transition */
      mint?: boolean;
    }
  | { kind: 'rotate'; from: LifecycleState; reason: string }
  | { kind: 'revoke'; from: LifecycleState; reason: string };

const r2 = (n: number): string => n.toFixed(2);

/** Pure: given a live reading + config, what should the runner do this tick? */
export function decideLifecycle(r: LifecycleReading, cfg: LifecycleConfig): LifecycleDecision {
  const spendable = r.balanceUsd - cfg.reserveUsd;
  const S = r.state;

  // IDS mismatch (provider gateway spend outpaced the local ledger) preempts
  // everything from any state that holds a key.
  if (r.ids.mismatch && S !== 'NO_KEY' && S !== 'STARVED' && S !== 'REVOKING') {
    return { kind: 'revoke', from: S, reason: r.ids.reason };
  }

  switch (S) {
    case 'REVOKING':
      // The runner completes REVOKING within the tick it enters it; only reached
      // if a process died mid-revoke.
      return { kind: 'transition', from: S, to: 'NO_KEY', event: 'REVOKED', reason: 'completing a pending revoke' };

    case 'NO_KEY':
      if (r.halted) {
        return { kind: 'steady', state: 'NO_KEY', reason: 'halted — awaiting a manual credential action (pnpm orbio:auth)' };
      }
      if (spendable <= 0) {
        return {
          kind: 'transition',
          from: S,
          to: 'STARVED',
          event: 'NO_CREDITS',
          reason: `balance $${r2(r.balanceUsd)} ≤ reserve $${r2(cfg.reserveUsd)} — nothing to serve`,
        };
      }
      return {
        kind: 'transition',
        from: S,
        to: 'ACTIVE',
        event: 'KEY_CLAIMED',
        mint: true,
        reason: `minted a gateway key (balance $${r2(r.balanceUsd)}, spendable $${r2(spendable)})`,
      };

    case 'ROTATING':
      return { kind: 'transition', from: S, to: 'ACTIVE', event: 'KEY_CLAIMED', mint: true, reason: 'completing a pending rotation' };

    case 'STARVED':
      if (spendable > 0) {
        return r.hasKey && r.holdSecret
          ? {
              kind: 'transition',
              from: S,
              to: 'ACTIVE',
              event: 'KEY_CLAIMED',
              reason: `balance recovered to $${r2(r.balanceUsd)} — key still valid`,
            }
          : {
              kind: 'transition',
              from: S,
              to: 'ACTIVE',
              event: 'KEY_CLAIMED',
              mint: true,
              reason: `balance recovered to $${r2(r.balanceUsd)} — minting`,
            };
      }
      return {
        kind: 'steady',
        state: 'STARVED',
        reason: `waiting for accrual — balance $${r2(r.balanceUsd)}, reserve $${r2(cfg.reserveUsd)}`,
      };

    case 'ACTIVE':
    case 'DRAINING': {
      if (!r.hasKey) {
        return { kind: 'transition', from: S, to: 'NO_KEY', event: 'REVOKED', reason: 'provider reports no key — lost outside the runner' };
      }
      if (!r.holdSecret) {
        return { kind: 'revoke', from: S, reason: 'key present at provider but its secret is not in the store — revoking to remint' };
      }
      if (r.keyAgeDays != null && r.keyAgeDays >= cfg.hygieneRotateDays) {
        return { kind: 'rotate', from: S, reason: `key age ${r.keyAgeDays.toFixed(1)}d ≥ ${cfg.hygieneRotateDays}d (hygiene)` };
      }
      if (spendable <= 0) {
        return {
          kind: 'transition',
          from: S,
          to: 'STARVED',
          event: 'NO_CREDITS',
          reason: `balance $${r2(r.balanceUsd)} ≤ reserve $${r2(cfg.reserveUsd)} — no rotate (a new key spends the same balance)`,
        };
      }
      if (r.balanceUsd < cfg.lowWaterUsd) {
        return S === 'ACTIVE'
          ? {
              kind: 'transition',
              from: S,
              to: 'DRAINING',
              event: 'LOW_BALANCE',
              reason: `balance $${r2(r.balanceUsd)} < low-water $${r2(cfg.lowWaterUsd)} (still serving, flagged)`,
            }
          : { kind: 'steady', state: 'DRAINING', reason: `draining — balance $${r2(r.balanceUsd)}` };
      }
      return S === 'DRAINING'
        ? {
            kind: 'transition',
            from: S,
            to: 'ACTIVE',
            event: 'STATUS_OK',
            reason: `balance recovered to $${r2(r.balanceUsd)} (≥ low-water $${r2(cfg.lowWaterUsd)})`,
          }
        : {
            kind: 'steady',
            state: 'ACTIVE',
            reason: `ok — balance $${r2(r.balanceUsd)}, key age ${r.keyAgeDays?.toFixed(1) ?? '?'}d`,
          };
    }
  }
}

/** Warn (do not throw) when the adapted decision diverges from the reference machine. */
export function checkAgainstStateMachine(from: LifecycleState, event: LifecycleEvent, to: LifecycleState): boolean {
  const n = nextState(from, event);
  const ok = n?.state === to;
  if (!ok) {
    // eslint-disable-next-line no-console
    console.warn(`[metabolism] adapted transition ${from} --${event}--> ${to} diverges from state.ts (got ${n?.state ?? 'null'})`);
  }
  return ok;
}

/* ─────────────────────── signed lifecycle_log writer ─────────────────────── */

export interface LifecycleRowInput {
  isSnapshot: boolean;
  prevState: LifecycleState | null;
  newState: LifecycleState;
  reason: string;
  keyId?: string | null;
  keyHashPrefix?: string | null;
  balanceUsd?: number | null;
  reserveUsd?: number | null;
  ledgerSpendUsd?: number | null;
  providerSpendUsd?: number | null;
  idsMismatch?: boolean;
}

export interface PersistedLifecycleRow {
  id: string;
  prevHash: Hex;
  bodyHash: Hex;
  signature: Hex;
  at: string;
}

/** The record handed to the persistence layer — the full DB row minus `id`/indexes. */
export interface LifecyclePersistRecord {
  isSnapshot: boolean;
  prevState: LifecycleState | null;
  newState: LifecycleState;
  reason: string;
  keyId: string | null;
  keyHashPrefix: string | null;
  balanceUsd: number | null;
  keyRemainingUsd: null;
  reserveUsd: number | null;
  ledgerSpendUsd: number | null;
  providerSpendUsd: number | null;
  idsMismatch: boolean;
  prevHash: string;
  bodyHash: string;
  signature: string;
  createdAt: Date;
}

export type LifecyclePersist = (record: LifecyclePersistRecord) => Promise<{ id: string }>;

const prismaPersist: LifecyclePersist = async (record) => {
  const row = await prisma.lifecycleLog.create({
    data: record as Prisma.LifecycleLogUncheckedCreateInput,
    select: { id: true },
  });
  return { id: row.id };
};

/**
 * Appends hash-chained, agent-signed rows to `lifecycle_log`. Keeps the running
 * `prevHash` in memory so several appends in one tick chain correctly; seed it
 * from the last DB row via {@link LifecycleLogWriter.fromDb}.
 */
export class LifecycleLogWriter {
  private prevHash: Hex;

  constructor(
    private readonly agentPrivateKey: Hex,
    seedPrevHash: Hex,
    private readonly persist: LifecyclePersist = prismaPersist,
  ) {
    this.prevHash = seedPrevHash;
  }

  static async fromDb(agentPrivateKey: Hex, persist: LifecyclePersist = prismaPersist): Promise<LifecycleLogWriter> {
    const last = await prisma.lifecycleLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { bodyHash: true },
    });
    return new LifecycleLogWriter(agentPrivateKey, (last?.bodyHash as Hex) ?? GENESIS_HASH, persist);
  }

  get head(): Hex {
    return this.prevHash;
  }

  async append(input: LifecycleRowInput): Promise<PersistedLifecycleRow> {
    const at = new Date();
    const entry = buildLifecycleEntry(
      {
        prevState: input.prevState,
        newState: input.newState,
        reason: input.reason,
        isSnapshot: input.isSnapshot,
        keyHashPrefix: input.keyHashPrefix ?? undefined,
        balanceUsd: input.balanceUsd ?? undefined,
        reserveUsd: input.reserveUsd ?? undefined,
        ledgerSpendUsd: input.ledgerSpendUsd ?? undefined,
        providerSpendUsd: input.providerSpendUsd ?? undefined,
        idsMismatch: input.idsMismatch ?? false,
        at: at.toISOString(),
      },
      this.prevHash,
    );
    const signature = await signLifecycleEntry(entry.bodyHash, this.agentPrivateKey);
    const { id } = await this.persist({
      isSnapshot: input.isSnapshot,
      prevState: input.prevState,
      newState: input.newState,
      reason: input.reason,
      keyId: input.keyId ?? null,
      keyHashPrefix: input.keyHashPrefix ?? null,
      balanceUsd: input.balanceUsd ?? null,
      keyRemainingUsd: null,
      reserveUsd: input.reserveUsd ?? null,
      ledgerSpendUsd: input.ledgerSpendUsd ?? null,
      providerSpendUsd: input.providerSpendUsd ?? null,
      idsMismatch: input.idsMismatch ?? false,
      prevHash: this.prevHash,
      bodyHash: entry.bodyHash,
      signature,
      createdAt: at,
    });
    this.prevHash = entry.bodyHash;
    return { id, prevHash: entry.prevHash, bodyHash: entry.bodyHash, signature, at: entry.at };
  }
}

/* ───────────────────────────── the 60s loop ───────────────────────────── */

function samePrefix(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.slice(0, 14) === b.slice(0, 14);
}

export interface LifecycleLoopDeps {
  connect?: () => Promise<OrbioConnection>;
  writer?: LifecycleLogWriter;
}

export async function runLifecycleLoop(
  signal: { stopped: boolean },
  deps: LifecycleLoopDeps = {},
): Promise<void> {
  const env = loadEnv();
  if (!env.agentPrivateKey) {
    // eslint-disable-next-line no-console
    console.warn('[metabolism] AGENT_EIP712_PRIVATE_KEY not set — lifecycle loop not started');
    return;
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[metabolism] TOKEN_ENCRYPTION_KEY not set — lifecycle loop not started');
    return;
  }
  const agentPk = env.agentPrivateKey;
  const cfg: LifecycleConfig = {
    reserveUsd: env.metabolismReserveUsd,
    lowWaterUsd: env.metabolismLowWaterUsd,
    hygieneRotateDays: env.metabolismHygieneRotateDays,
    idsToleranceUsd: env.metabolismIdsToleranceUsd,
    idsGraceUsd: env.metabolismIdsGraceUsd,
  };
  const intervalMs = env.metabolismStatusPollSec * 1000;
  const connect = deps.connect ?? (() => connectOrbio());
  const writer = deps.writer ?? (await LifecycleLogWriter.fromDb(agentPk));
  const storePath = tokenStorePath();
  const encKey = loadEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY);

  const last = await prisma.lifecycleLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { newState: true, idsMismatch: true },
  });
  let state: LifecycleState = (last?.newState as LifecycleState) ?? 'NO_KEY';
  let halted = last?.newState === 'NO_KEY' && last?.idsMismatch === true;

  // eslint-disable-next-line no-console
  console.log(
    `[metabolism] lifecycle loop every ${env.metabolismStatusPollSec}s · reserve $${cfg.reserveUsd} · low-water $${cfg.lowWaterUsd} · hygiene ${cfg.hygieneRotateDays}d · start ${state}${halted ? ' (HALTED)' : ''}`,
  );

  let conn: OrbioConnection | null = null;
  const dropConn = async (): Promise<void> => {
    if (conn) {
      await conn.close().catch(() => {});
      conn = null;
    }
  };

  while (!signal.stopped) {
    try {
      if (!conn) conn = await connect();
      const c = conn;

      const [balance, status] = await Promise.all([
        orbioGetBalance(c.client),
        orbioGetKeyStatus(c.client),
      ]);
      const ledgerSpendUsd = await totalSpendUsd();
      const providerSpendUsd = balance.spent.usd;
      const blob = readOAuthBlob(storePath, encKey);

      // Establish / refresh the per-key IDS baseline before reconciling, so the
      // first tick with a new key never trips.
      if (
        status.hasKey &&
        status.prefix &&
        (!blob.spendBaseline || blob.spendBaseline.keyPrefix !== status.prefix)
      ) {
        blob.spendBaseline = {
          keyPrefix: status.prefix,
          providerSpentUsd: providerSpendUsd,
          ledgerUsd: ledgerSpendUsd,
          at: new Date().toISOString(),
        };
        updateOAuthBlob(storePath, encKey, { spendBaseline: blob.spendBaseline });
        // eslint-disable-next-line no-console
        console.log(`[metabolism] IDS baseline set for ${status.prefix} (provider $${r2(providerSpendUsd)}, ledger $${r2(ledgerSpendUsd)})`);
      }

      const ids = reconcileIds({
        keyPrefix: status.prefix ?? null,
        providerSpentUsd: providerSpendUsd,
        ledgerSpendUsd,
        baseline: blob.spendBaseline ?? null,
        toleranceUsd: cfg.idsToleranceUsd,
        graceUsd: cfg.idsGraceUsd,
      });

      const holdSecret =
        typeof blob.gatewayKey === 'string' &&
        blob.gatewayKey.length > 0 &&
        (!status.prefix || samePrefix(status.prefix, blob.gatewayKeyPrefix));

      const reading: LifecycleReading = {
        state,
        halted,
        balanceUsd: balance.balance.usd,
        hasKey: status.hasKey,
        holdSecret,
        keyAgeDays:
          status.hasKey && status.createdAt
            ? (Date.now() - Date.parse(status.createdAt)) / 86_400_000
            : null,
        ledgerSpendUsd,
        providerSpendUsd,
        ids,
      };

      const idsMismatch = ids.mismatch;
      const common = {
        balanceUsd: reading.balanceUsd,
        reserveUsd: cfg.reserveUsd,
        ledgerSpendUsd: reading.ledgerSpendUsd,
        providerSpendUsd: reading.providerSpendUsd,
        keyId: status.prefix ?? blob.gatewayKeyPrefix ?? null,
        keyHashPrefix: blob.gatewayKeyPrefix ?? null,
      };

      const mint = async (why: string): Promise<string> => {
        const created = await orbioCreateKey(c.client, {
          label: `launch-auditor ${new Date().toISOString().slice(0, 10)}`,
        });
        updateOAuthBlob(storePath, encKey, {
          gatewayKey: created.key,
          gatewayKeyPrefix: created.prefix,
          // fresh key ⇒ fresh IDS baseline (this tick's provider spend, current ledger Σ)
          spendBaseline: {
            keyPrefix: created.prefix,
            providerSpentUsd: providerSpendUsd,
            ledgerUsd: ledgerSpendUsd,
            at: new Date().toISOString(),
          },
        });
        // eslint-disable-next-line no-console
        console.log(`[metabolism] minted ${created.prefix} (${why})`);
        return created.prefix;
      };

      const decision = decideLifecycle(reading, cfg);
      if (ids.direction === 'ledger_ahead') {
        // eslint-disable-next-line no-console
        console.warn(`[metabolism] ${ids.reason}`);
      }

      if (decision.kind === 'steady') {
        await writer.append({
          isSnapshot: true,
          prevState: state,
          newState: state,
          reason: decision.reason,
          idsMismatch,
          ...common,
        });
      } else if (decision.kind === 'transition') {
        let { keyId, keyHashPrefix } = common;
        if (decision.mint) {
          const p = await mint(decision.reason);
          keyId = p;
          keyHashPrefix = p;
        }
        checkAgainstStateMachine(decision.from, decision.event, decision.to);
        await writer.append({
          isSnapshot: false,
          prevState: decision.from,
          newState: decision.to,
          reason: decision.reason,
          idsMismatch,
          ...common,
          keyId,
          keyHashPrefix,
        });
        state = decision.to;
        await writer.append({
          isSnapshot: true,
          prevState: state,
          newState: state,
          reason: `snapshot after → ${state}`,
          idsMismatch,
          ...common,
          keyId,
          keyHashPrefix,
        });
      } else if (decision.kind === 'rotate') {
        checkAgainstStateMachine(decision.from, 'HYGIENE_DUE', 'ROTATING');
        await writer.append({
          isSnapshot: false,
          prevState: decision.from,
          newState: 'ROTATING',
          reason: decision.reason,
          idsMismatch,
          ...common,
        });
        const p = await mint(`hygiene rotation from ${decision.from}`);
        checkAgainstStateMachine('ROTATING', 'KEY_CLAIMED', 'ACTIVE');
        await writer.append({
          isSnapshot: false,
          prevState: 'ROTATING',
          newState: 'ACTIVE',
          reason: `rotated to ${p} (hygiene)`,
          idsMismatch,
          ...common,
          keyId: p,
          keyHashPrefix: p,
        });
        state = 'ACTIVE';
        await writer.append({
          isSnapshot: true,
          prevState: state,
          newState: state,
          reason: `snapshot after → ${state}`,
          idsMismatch,
          ...common,
          keyId: p,
          keyHashPrefix: p,
        });
      } else {
        // revoke (IDS mismatch or unusable key)
        checkAgainstStateMachine(decision.from, 'IDS_MISMATCH', 'REVOKING');
        await writer.append({
          isSnapshot: false,
          prevState: decision.from,
          newState: 'REVOKING',
          reason: decision.reason,
          idsMismatch: true,
          ...common,
        });
        try {
          await orbioRevokeKey(c.client);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[metabolism] revoke_key failed', e instanceof Error ? e.message : e);
        }
        updateOAuthBlob(storePath, encKey, {
          gatewayKey: null,
          gatewayKeyPrefix: null,
          spendBaseline: null,
        });
        checkAgainstStateMachine('REVOKING', 'REVOKED', 'NO_KEY');
        await writer.append({
          isSnapshot: false,
          prevState: 'REVOKING',
          newState: 'NO_KEY',
          reason: 'revoked at provider — halting for manual re-auth (pnpm orbio:auth)',
          idsMismatch: true,
          ...common,
          keyId: null,
          keyHashPrefix: null,
        });
        state = 'NO_KEY';
        halted = true;
        await writer.append({
          isSnapshot: true,
          prevState: state,
          newState: state,
          reason: 'snapshot after → NO_KEY (HALTED)',
          idsMismatch: true,
          ...common,
          keyId: null,
          keyHashPrefix: null,
        });
      }

      if (decision.kind !== 'steady') {
        const label =
          decision.kind === 'transition' ? `${decision.from} → ${decision.to}` : decision.kind.toUpperCase();
        // eslint-disable-next-line no-console
        console.log(`[metabolism] ${label}: ${decision.reason}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[metabolism] tick error', err instanceof Error ? err.message : err);
      await dropConn();
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  await dropConn();
}
