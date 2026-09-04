import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('api', () => {
  it('GET /health returns ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'launch-auditor-api' });
    await app.close();
  });
});
