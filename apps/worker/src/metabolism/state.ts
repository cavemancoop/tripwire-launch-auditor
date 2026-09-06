/**
 * Metabolism state machine (spec §8, unchanged from v0.1 §7):
 *   NO_KEY → ACTIVE → DRAINING → ROTATING → ACTIVE
 *   any → REVOKING → NO_KEY            (IDS mismatch: local ledger vs provider)
 *   DRAINING/ROTATING/NO_KEY → STARVED (no credits to claim or rotate into)
 *   STARVED → ROTATING/ACTIVE          (credits returned)
 *
 * Pure: `nextState(current, event)` returns the new state + a reason string, or
 * null when the event does not apply in the current state.
 */
export type LifecycleState =
  | 'NO_KEY'
  | 'ACTIVE'
  | 'DRAINING'
  | 'ROTATING'
  | 'REVOKING'
  | 'STARVED';

export type LifecycleEvent =
  | 'KEY_CLAIMED' // a fresh OpenRouter key was claimed from Orbio
  | 'STATUS_OK' // periodic status poll: healthy, above reserve
  | 'LOW_BALANCE' // key remaining is low but still usable
  | 'HYGIENE_DUE' // key age >= hygieneRotateDays — rotate on schedule
  | 'DRAINED' // key remaining <= reserve
  | 'ROTATED' // new key claimed and the old one revoked
  | 'IDS_MISMATCH' // local spend ledger disagrees with orbio_get_key_status
  | 'REVOKED' // the key has been revoked at the provider
  | 'NO_CREDITS' // no accrued credits to claim / rotate into
  | 'CREDITS_RETURNED'; // credits accrued again after STARVED

export interface Transition {
  state: LifecycleState;
  reason: string;
}

const R = (state: LifecycleState, reason: string): Transition => ({ state, reason });

export function nextState(
  current: LifecycleState,
  event: LifecycleEvent,
): Transition | null {
  // IDS mismatch always wins, from any state that holds a key
  if (event === 'IDS_MISMATCH') {
    return current === 'NO_KEY' ? null : R('REVOKING', 'ids: local ledger vs provider status mismatch');
  }
  if (event === 'REVOKED') {
    return current === 'REVOKING' ? R('NO_KEY', 'key revoked at provider') : null;
  }

  switch (current) {
    case 'NO_KEY':
      if (event === 'KEY_CLAIMED') return R('ACTIVE', 'claimed a fresh key');
      if (event === 'NO_CREDITS') return R('STARVED', 'no credits to claim a key');
      return null;

    case 'ACTIVE':
      if (event === 'LOW_BALANCE') return R('DRAINING', 'key remaining is low');
      if (event === 'DRAINED') return R('ROTATING', 'key drained below reserve');
      if (event === 'HYGIENE_DUE') return R('ROTATING', 'scheduled key rotation (hygiene)');
      if (event === 'STATUS_OK') return R('ACTIVE', 'status ok');
      return null;

    case 'DRAINING':
      if (event === 'DRAINED') return R('ROTATING', 'key drained below reserve');
      if (event === 'HYGIENE_DUE') return R('ROTATING', 'scheduled key rotation (hygiene)');
      if (event === 'NO_CREDITS') return R('STARVED', 'drained and no credits to rotate into');
      if (event === 'STATUS_OK') return R('ACTIVE', 'balance recovered above the low mark');
      return null;

    case 'ROTATING':
      if (event === 'ROTATED' || event === 'KEY_CLAIMED') return R('ACTIVE', 'rotated to a fresh key');
      if (event === 'NO_CREDITS') return R('STARVED', 'nothing to rotate into');
      return null;

    case 'STARVED':
      if (event === 'CREDITS_RETURNED') return R('ROTATING', 'credits accrued — rotating back in');
      if (event === 'KEY_CLAIMED') return R('ACTIVE', 'claimed a key after starvation');
      return null;

    case 'REVOKING':
      return null; // only REVOKED (handled above) leaves REVOKING

    default:
      return null;
  }
}

/** A reason string prefixed `manual:` marks a human credential action (spec §8
 *  "days since the last manual credential action"). */
export const manualReason = (what: string): string => `manual: ${what}`;
export const isManualReason = (reason: string): boolean => reason.startsWith('manual:');
