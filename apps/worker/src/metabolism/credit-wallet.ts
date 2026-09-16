import { decodeEventLog, parseAbi, parseUnits, formatUnits, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * The agent's own Orbio account, on-chain (Orbio "for agents", 2026-09-16).
 *
 * - **Key:** the wallet signs `Orbio API key · chain 4663 · epoch N`; the
 *   encoded signature *is* the API key. No key-creation call, no expiry;
 *   rotation is a higher epoch. The account (and so the key) exists once the
 *   wallet has activated CREDIT; before that the gateway answers 401.
 * - **Top-up:** `CREDIT.activate(amount)` burns CREDIT the wallet holds into
 *   that wallet's AI balance. Irreversible, and the resulting balance can only
 *   be spent on inference — it cannot be transferred or cashed out.
 *
 * Safety: the agent wallet may call exactly two protocol functions,
 * `CREDIT.activate` and `Staking.claim` ({@link assertAllowedCall}). There is no
 * code path to transfer, approve, sell, swap or unstake anything.
 */

export const orbioKeyMessage = (epoch: number): string => `Orbio API key · chain 4663 · epoch ${epoch}`;

export async function deriveOrbioApiKey(privateKey: Hex, epoch = 0): Promise<string> {
  const signature = await privateKeyToAccount(privateKey).signMessage({ message: orbioKeyMessage(epoch) });
  return `sk-orb-${epoch}-${Buffer.from(signature.slice(2), 'hex').toString('base64')}`;
}

/** Safe to log: scheme + epoch + 4 chars, never enough to use. */
export const describeKey = (key: string): string => `${key.slice(0, key.indexOf('-', 7) + 5)}… (${key.length} chars)`;

export const CREDIT_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function activate(uint256 amount) returns (uint256 activationId)',
  'event Activated(uint256 indexed activationId, address indexed from, bytes32 indexed beneficiary, uint256 amount)',
]);

export interface ProtocolAddresses {
  credit: Hex;
  staking?: Hex;
}

/** The complete list of protocol calls the agent wallet is allowed to make. */
export function assertAllowedCall(to: string, functionName: string, addr: ProtocolAddresses): void {
  const t = to.toLowerCase();
  const ok =
    (t === addr.credit.toLowerCase() && functionName === 'activate') ||
    (addr.staking !== undefined && t === addr.staking.toLowerCase() && functionName === 'claim');
  if (!ok) throw new Error(`refusing ${functionName} on ${to}: the agent wallet may only call CREDIT.activate and Staking.claim`);
}

export interface ActivationInputs {
  apiBalanceUsd: number;
  creditHeldUsd: number;
  lowWaterUsd: number;
  chunkUsd: number;
  activatedTodayUsd: number;
  dailyCapUsd: number;
  /** an earlier activation has not shown up in the API balance yet */
  pending: boolean;
}

export type ActivationDecision = { activate: false; reason: string } | { activate: true; amountUsd: number; reason: string };

const usd = (n: number): string => `$${n.toFixed(2)}`;

/** Pure: should the agent turn some of its CREDIT into AI balance this tick, and how much? */
export function activationDecision(i: ActivationInputs): ActivationDecision {
  if (i.pending) return { activate: false, reason: 'previous activation not yet reflected in the API balance' };
  if (i.apiBalanceUsd >= i.lowWaterUsd) {
    return { activate: false, reason: `API balance ${usd(i.apiBalanceUsd)} ≥ activation low-water ${usd(i.lowWaterUsd)}` };
  }
  if (i.creditHeldUsd <= 0) return { activate: false, reason: 'wallet holds no CREDIT to activate' };
  const capLeft = i.dailyCapUsd - i.activatedTodayUsd;
  if (capLeft <= 0) {
    return { activate: false, reason: `daily activation cap ${usd(i.dailyCapUsd)} reached (${usd(i.activatedTodayUsd)} today)` };
  }
  const amountUsd = Math.floor(Math.min(i.chunkUsd, i.creditHeldUsd, capLeft) * 1e6) / 1e6;
  if (amountUsd < 0.01) return { activate: false, reason: `activatable amount ${usd(amountUsd)} too small` };
  return {
    activate: true,
    amountUsd,
    reason: `API balance ${usd(i.apiBalanceUsd)} < low-water ${usd(i.lowWaterUsd)}; activating ${usd(amountUsd)} of ${usd(i.creditHeldUsd)} CREDIT held`,
  };
}

/** Pure: first block at or after `targetSec`, interpolated from two known blocks. */
export function estimateBlockAt(
  targetSec: number,
  head: { number: bigint; timestamp: bigint },
  ref: { number: bigint; timestamp: bigint },
): bigint {
  const secs = Number(head.timestamp - ref.timestamp);
  if (secs <= 0 || targetSec >= Number(head.timestamp)) return head.number;
  const perSec = Number(head.number - ref.number) / secs;
  // round away from the target so the window never starts after midnight
  const back = BigInt(Math.ceil((Number(head.timestamp) - targetSec) * perSec * 1.02));
  return head.number > back ? head.number - back : 0n;
}

export async function creditHeldUsd(pub: PublicClient, credit: Hex, wallet: Hex): Promise<number> {
  const raw = await pub.readContract({ address: credit, abi: CREDIT_ABI, functionName: 'balanceOf', args: [wallet] });
  return Number(formatUnits(raw, 6));
}

/** Σ CREDIT this wallet activated since UTC midnight, from its own on-chain Activated events. */
export async function activatedTodayUsd(pub: PublicClient, credit: Hex, wallet: Hex, maxRange: bigint): Promise<number> {
  const head = await pub.getBlock();
  const ref = await pub.getBlock({ blockNumber: head.number > 10_000n ? head.number - 10_000n : 0n });
  const now = new Date();
  const midnight = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
  let from = estimateBlockAt(midnight, head, ref);
  let total = 0n;
  while (from <= head.number) {
    const to = from + maxRange - 1n > head.number ? head.number : from + maxRange - 1n;
    const logs = await pub.getContractEvents({ address: credit, abi: CREDIT_ABI, eventName: 'Activated', args: { from: wallet }, fromBlock: from, toBlock: to });
    for (const l of logs) total += l.args.amount ?? 0n;
    from = to + 1n;
  }
  return Number(formatUnits(total, 6));
}

export interface ActivationReceipt {
  txHash: Hex;
  activationId: bigint | null;
  amountUsd: number;
  blockNumber: bigint;
}

export async function activateCredit(args: {
  wallet: WalletClient;
  pub: PublicClient;
  addresses: ProtocolAddresses;
  amountUsd: number;
  receiptTimeoutMs?: number;
}): Promise<ActivationReceipt> {
  assertAllowedCall(args.addresses.credit, 'activate', args.addresses);
  const amount = parseUnits(args.amountUsd.toFixed(6), 6);
  const txHash = await args.wallet.writeContract({
    address: args.addresses.credit,
    abi: CREDIT_ABI,
    functionName: 'activate',
    args: [amount],
    account: args.wallet.account!,
    chain: args.wallet.chain,
  });
  const deadline = Date.now() + (args.receiptTimeoutMs ?? 120_000);
  for (;;) {
    const r = await args.pub.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (r) {
      if (r.status !== 'success') throw new Error(`CREDIT.activate reverted (${txHash})`);
      let activationId: bigint | null = null;
      for (const log of r.logs) {
        if (log.address.toLowerCase() !== args.addresses.credit.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: CREDIT_ABI, data: log.data, topics: log.topics });
          if (ev.eventName === 'Activated') activationId = ev.args.activationId;
        } catch {
          /* Transfer (burn) and other logs */
        }
      }
      return { txHash, activationId, amountUsd: args.amountUsd, blockNumber: r.blockNumber };
    }
    if (Date.now() > deadline) throw new Error(`CREDIT.activate ${txHash}: no receipt after ${args.receiptTimeoutMs ?? 120_000}ms (check the explorer before retrying)`);
    await new Promise((res) => setTimeout(res, 2_000));
  }
}
