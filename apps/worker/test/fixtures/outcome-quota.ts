import { vi } from 'vitest';
import type { Hex } from 'viem';
import type { ResolverContext } from '../../src/outcomes/context';
import type { PoolKey } from '../../src/outcomes/quote';
import type { PoolRef } from '../../src/outcomes/series';

// Package 4a fixtures: provider failures as the resolvers actually receive them.

/** The exact provider text from the 2026-09-18 outage (CHANGELOG.md). */
export const QUOTA_18_SEP = "You've reached your monthly quota of Request Units";

class Named extends Error {
  constructor(name: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = name;
    Object.assign(this, extra);
  }
}

export const named = (name: string, message: string, extra: Record<string, unknown> = {}): Error =>
  new Named(name, message, extra);

/** viem's RpcRequestError shape: the first line says nothing, the text is in `details`,
 *  and the message carries the (key-bearing) RPC URL */
export const viemRpcError = (details: string, url = 'https://rpc.example/KEY'): Error =>
  named(
    'RpcRequestError',
    `RPC Request failed.\n\nURL: ${url}\nRequest body: {"method":"eth_call"}\n\nDetails: ${details}\nVersion: viem@2`,
    { shortMessage: 'RPC Request failed.', details },
  );

export const POOL_ID = `0x${'44'.repeat(32)}` as Hex;

export const V4_POOL: PoolRef = {
  poolKind: 'v4',
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  poolAddress: null,
  poolId: POOL_ID,
  tokenIsCurrency0: true,
};

export const POOL_KEY: PoolKey = {
  currency0: '0x00000000000000000000000000000000000000ff',
  currency1: '0x0000000000000000000000000000000000000011',
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000',
};

export const resolverCtx = (over: Partial<ResolverContext>): ResolverContext => ({
  client: over.client!,
  chainId: 4663,
  maxRange: 10_000,
  pool: V4_POOL,
  token: '0x00000000000000000000000000000000000000ff',
  quote: '0x0000000000000000000000000000000000000011',
  poolKey: null,
  quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  quoteDecimals: 6,
  launchBlock: 5n,
  lpLockedByConstruction: false,
  clusterWallets: [],
  label: 'TRADING_ALIVE',
  horizon: '24h',
  trigger: 'launch',
  anchorBlock: 10n,
  horizonBlock: 1_000_000n,
  drawdownRefStart: 0n,
  drawdownRefEnd: 0n,
  ...over,
});

/** every request fails with `err` */
export const failingClient = (err: unknown) => ({
  request: vi.fn(async () => {
    throw err;
  }),
});

/** eth_getLogs served from `logs`, filtered to the requested range */
export const logClient = (logs: Array<{ blockNumber: string }>) => ({
  request: vi.fn(async ({ method, params }: { method: string; params: any[] }) => {
    if (method !== 'eth_getLogs') throw new Error(method);
    const from = BigInt(params[0].fromBlock);
    const to = BigInt(params[0].toBlock);
    return logs.filter((l) => {
      const b = BigInt(l.blockNumber);
      return b >= from && b <= to;
    });
  }),
});
