import { describe, expect, it, vi } from 'vitest';
import { GENESIS_HASH, lifecycleBodyHash } from '@launch-auditor/db';
import { buildServer, type EstimatorSummary, type LifecycleApiRow } from '../src/server';

// every test below stubs this — the default hits Prisma, and these tests are
// about the hash chain / limit clamping, not the M5c estimator block.
const EMPTY_ESTIMATOR: EstimatorSummary = {
  windows: 0,
  providerSpend24hUsd: 0,
  estimatedSpend24hUsd: 0,
  requests24h: 0,
  meanAbsDiscrepancyPct: null,
  latest: null,
};

/** Build a valid hash-chained run of `n` rows, oldest → newest. */
function chain(n: number): LifecycleApiRow[] {
  const rows: LifecycleApiRow[] = [];
  let prevHash: string = GENESIS_HASH;
  for (let i = 0; i < n; i += 1) {
    const body = {
      at: new Date(1_760_000_000_000 + i * 60_000).toISOString(),
      prevState: (i === 0 ? null : 'NO_KEY') as string | null,
      newState: 'NO_KEY',
      reason: i === 0 ? 'instance start' : `snapshot ${i}`,
      isSnapshot: i !== 0,
      keyHashPrefix: null,
      balanceUsd: 24.01,
      keyRemainingUsd: null,
      reserveUsd: 3,
      ledgerSpendUsd: 0,
      providerSpendUsd: 0,
      idsMismatch: false,
      prevHash: prevHash as `0x${string}`,
    };
    const bodyHash = lifecycleBodyHash(body);
    rows.push({ id: `row-${i}`, signature: `0xsig${i}`, keyId: null, ...body, bodyHash });
    prevHash = bodyHash;
  }
  return rows;
}

describe('GET /v1/lifecycle', () => {
  it('serves the signed chain and verifies it', async () => {
    const rows = chain(3);
    const reader = vi.fn(async () => rows);
    const app = buildServer({ lifecycleReader: reader, estimatorReader: async () => EMPTY_ESTIMATOR });

    const res = await app.inject({ method: 'GET', url: '/v1/lifecycle' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(3);
    expect(body.verified).toBe(true);
    expect(body.startsAtGenesis).toBe(true);
    expect(body.brokenAt).toBeNull();
    expect(body.genesisHash).toBe(GENESIS_HASH);
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0].bodyHash).toBe(rows[0]!.bodyHash);
    expect(reader).toHaveBeenCalledWith(200);
    await app.close();
  });

  it('reports verified:false when a served row is tampered', async () => {
    const rows = chain(3);
    rows[1] = { ...rows[1]!, reason: 'tampered after signing' };
    const app = buildServer({ lifecycleReader: async () => rows, estimatorReader: async () => EMPTY_ESTIMATOR });

    const body = (await app.inject({ method: 'GET', url: '/v1/lifecycle' })).json();
    expect(body.verified).toBe(false);
    expect(body.brokenAt).toBe(1);
    await app.close();
  });

  it('clamps ?limit and passes it to the reader', async () => {
    const reader = vi.fn(async () => chain(1));
    const app = buildServer({ lifecycleReader: reader, estimatorReader: async () => EMPTY_ESTIMATOR });

    await app.inject({ method: 'GET', url: '/v1/lifecycle?limit=99999' });
    expect(reader).toHaveBeenCalledWith(1000);

    await app.inject({ method: 'GET', url: '/v1/lifecycle?limit=1' });
    expect(reader).toHaveBeenLastCalledWith(1);
    await app.close();
  });

  it('empty log verifies vacuously', async () => {
    const app = buildServer({ lifecycleReader: async () => [], estimatorReader: async () => EMPTY_ESTIMATOR });
    const body = (await app.inject({ method: 'GET', url: '/v1/lifecycle' })).json();
    expect(body).toMatchObject({ count: 0, verified: true, startsAtGenesis: true });
    await app.close();
  });

  // M5c: the metabolism's own cost-forecast error, graded like any other
  // forecaster, rides along on the same endpoint.
  it('carries the M5c estimator summary', async () => {
    const estimator: EstimatorSummary = {
      windows: 12,
      providerSpend24hUsd: 0.43,
      estimatedSpend24hUsd: 0.41,
      requests24h: 37,
      meanAbsDiscrepancyPct: 4.4,
      latest: { at: '2026-09-12T04:00:00.000Z', billingStatus: 'aggregate_only', discrepancyPct: 4.4, reconciliationFactor: 1.04 },
    };
    const app = buildServer({ lifecycleReader: async () => [], estimatorReader: async () => estimator });
    const body = (await app.inject({ method: 'GET', url: '/v1/lifecycle' })).json();
    expect(body.estimator).toEqual(estimator);
    await app.close();
  });
});
