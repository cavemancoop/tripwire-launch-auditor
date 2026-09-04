import { BlockscoutClient, getChainConfig } from '@launch-auditor/chain';
import { loadEnv } from '../env';

let client: BlockscoutClient | undefined;

export function blockscout(): BlockscoutClient {
  if (!client) {
    const { chainId } = loadEnv();
    client = new BlockscoutClient({ baseUrl: getChainConfig(chainId).blockscoutApi });
  }
  return client;
}
