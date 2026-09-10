import { describe, expect, it, vi } from 'vitest';
import { GENESIS_HASH, lifecycleBodyHash } from '@launch-auditor/db';
import { buildServer, type LifecycleApiRow } from '../src/server';

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
    const app = buildServer({ lifecycleReader: reader });

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
    const app = buildServer({ lifecycleReader: async () => rows });

    const body = (await app.inject({ method: 'GET', url: '/v1/lifecycle' })).json();
    expect(body.verified).toBe(false);
    expect(body.brokenAt).toBe(1);
    await app.close();
  });

  it('clamps ?limit and passes it to the reader', async () => {
    const reader = vi.fn(async () => chain(1));
    const app = buildServer({ lifecycleReader: reader });

    await app.inject({ method: 'GET', url: '/v1/lifecycle?limit=99999' });
    expect(reader).toHaveBeenCalledWith(1000);

    await app.inject({ method: 'GET', url: '/v1/lifecycle?limit=1' });
    expect(reader).toHaveBeenLastCalledWith(1);
    await app.close();
  });

  it('empty log verifies vacuously', async () => {
    const app = buildServer({ lifecycleReader: async () => [] });
    const body = (await app.inject({ method: 'GET', url: '/v1/lifecycle' })).json();
    expect(body).toMatchObject({ count: 0, verified: true, startsAtGenesis: true });
    await app.close();
  });
});
