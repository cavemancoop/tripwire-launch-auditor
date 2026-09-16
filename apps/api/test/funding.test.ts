import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { chainFundingReader, summarizeFunding, type FundingSummary } from '../src/funding';
import type { ApiEnv } from '../src/env';

const ENV: ApiEnv = {
  rpcUrl: '',
  chainId: 4663,
  designPartnerApiKeys: [],
  benchmarkFile: '/dev/null/unused.json',
  priceDeepdiveUsdg: 0.1,
  deepdiveDailyCapUsd: 5,
  deepdiveCapPerRunUsd: 0.2,
  metabolismReserveUsd: 0.5,
};
const AGENT = '0x9b4EDe199198ca3D41A9a7D2997606BaCd30BA03';

describe('summarizeFunding', () => {
  it('splits operator and agent activations, newest first', () => {
    const s = summarizeFunding(AGENT, [
      // the live one: Cooper's wallet activating 20 CREDIT into the agent's account
      { activationId: '58', amountUsd: 20, from: '0x4cb72456e82aeDd8b1ef0F08D03Cc6bFf96c6291', blockNumber: 64_784_388, at: null, txHash: '0xb7f8' },
      { activationId: '61', amountUsd: 5, from: AGENT.toLowerCase(), blockNumber: 64_800_000, at: null, txHash: '0xaaaa' },
    ]);
    expect(s.totalActivatedUsd).toBe(25);
    expect(s.byOperatorUsd).toBe(20);
    expect(s.byAgentUsd).toBe(5);
    expect(s.activations.map((a) => [a.activationId, a.by])).toEqual([['61', 'agent'], ['58', 'operator']]);
  });
});

describe('GET /v1/funding', () => {
  it('reports unconfigured instead of an empty success when env is missing', async () => {
    expect(await chainFundingReader(ENV)()).toMatchObject({ configured: false, activations: [] });
  });

  it('serves the reader and turns a reader failure into 503', async () => {
    const ok: FundingSummary = { configured: true, account: AGENT, creditAddress: '0xe333', fromBlock: 1, totalActivatedUsd: 20, byOperatorUsd: 20, byAgentUsd: 0, activations: [] };
    const app = buildServer({ env: ENV, fundingReader: async () => ok });
    expect((await app.inject({ method: 'GET', url: '/v1/funding' })).json()).toMatchObject({ totalActivatedUsd: 20 });
    const bad = buildServer({ env: ENV, fundingReader: async () => { throw new Error('rpc down'); } });
    const r = await bad.inject({ method: 'GET', url: '/v1/funding' });
    expect(r.statusCode).toBe(503);
    expect(r.json().detail).toBe('rpc down');
  });
});
