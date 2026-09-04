import { getPublicClient } from '@launch-auditor/chain';
import type { PublicClient } from 'viem';
import { loadEnv } from '../env';

let client: PublicClient | undefined;

export function rpc(): PublicClient {
  if (!client) {
    const { rpcUrl } = loadEnv();
    if (!rpcUrl) throw new Error('RH_RPC_URL is not set — the watcher needs an RPC for chain 4663');
    client = getPublicClient(rpcUrl);
  }
  return client;
}
