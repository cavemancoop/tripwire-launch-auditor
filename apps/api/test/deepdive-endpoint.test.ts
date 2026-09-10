import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server';

const TOKEN = '0x00000000000000000000000000000000DeC0DeD1';

describe('POST /v1/deepdive/:token', () => {
  it('enqueues an on-demand job and returns 202', async () => {
    const enqueue = vi.fn(async () => ({ id: 'job-1' }));
    const app = buildServer({ enqueueDeepdive: enqueue });

    const res = await app.inject({ method: 'POST', url: `/v1/deepdive/${TOKEN}` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: true, token: TOKEN.toLowerCase(), jobId: 'job-1' });
    expect(enqueue).toHaveBeenCalledWith({ tokenAddress: TOKEN.toLowerCase(), trigger: 'on_demand' });
    await app.close();
  });

  it('rejects a non-address token with 400', async () => {
    const enqueue = vi.fn();
    const app = buildServer({ enqueueDeepdive: enqueue as never });
    const res = await app.inject({ method: 'POST', url: '/v1/deepdive/not-a-token' });
    expect(res.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 503 when the queue is unavailable', async () => {
    const app = buildServer({
      enqueueDeepdive: async () => {
        throw new Error('redis down');
      },
    });
    const res = await app.inject({ method: 'POST', url: `/v1/deepdive/${TOKEN}` });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
