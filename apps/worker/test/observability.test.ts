import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { resetRpcBudget, schedulerFor, type SchedulerStats } from '@launch-auditor/rpc-budget';
import { startHealthServer } from '../src/health-server';
import { formatWorkerMetrics, obsLogLine, observe, sumTiers, TIERS } from '../src/observability';

const stats = (over: Partial<SchedulerStats>): SchedulerStats => ({
  enqueued: 0,
  started: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  inFlight: 0,
  queued: 0,
  byPriority: {},
  queuedByPriority: {},
  inFlightByPriority: {},
  completedByPriority: {},
  failedByPriority: {},
  ...over,
});

describe('sumTiers', () => {
  it('sums schedulers by tier and maps unknown priorities to other', () => {
    const t = sumTiers([
      stats({ byPriority: { 0: 5, 2: 3 }, queuedByPriority: { 2: 4 }, inFlightByPriority: { 2: 1 } }),
      stats({ byPriority: { 2: 1, 9: 7 }, completedByPriority: { 9: 6 }, failedByPriority: { 2: 2 } }),
    ]);
    expect(t.watcher.started).toBe(5);
    expect(t.outcomes).toEqual({ started: 4, completed: 0, failed: 2, queued: 4, inFlight: 1 });
    expect(t.other).toEqual({ started: 7, completed: 6, failed: 0, queued: 0, inFlight: 0 });
    expect(Object.keys(t)).toEqual([...TIERS]);
  });
});

describe('formatWorkerMetrics', () => {
  const o = observe(() => [stats({ byPriority: { 2: 3, 42: 1 } })]);
  const text = formatWorkerMetrics(o);
  const samples = text.split('\n').filter((l) => l && !l.startsWith('#'));

  it('emits exactly the 43 fixed series whatever the input', () => {
    expect(samples).toHaveLength(43);
    const many = formatWorkerMetrics(
      observe(() => Array.from({ length: 5 }, (_, i) => stats({ byPriority: { [100 + i]: 1 } }))),
    );
    expect(many.split('\n').filter((l) => l && !l.startsWith('#'))).toHaveLength(43);
  });

  it('labels only with the fixed tier and memory-kind sets', () => {
    const labels = new Set(samples.flatMap((l) => [...l.matchAll(/(\w+)="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`)));
    const allowed = new Set([
      ...TIERS.map((t) => `tier=${t}`),
      ...['rss', 'heap_used', 'heap_total', 'external', 'array_buffers'].map((k) => `kind=${k}`),
    ]);
    for (const l of labels) expect(allowed.has(l)).toBe(true);
    expect(text).toContain('tripwire_worker_rpc_started_total{tier="outcomes"} 3');
    expect(text).toContain('tripwire_worker_rpc_started_total{tier="other"} 1');
  });

  it('never carries a URL, even when a real scheduler exists for a key-bearing one', async () => {
    resetRpcBudget();
    const url = 'https://rpc.example/v1/SECRETKEY123';
    await schedulerFor(url).schedule(2, async () => 1);
    const live = observe(); // default reader: every real scheduler in the process
    resetRpcBudget();
    expect(live.tiers.outcomes.started).toBe(1);
    for (const out of [formatWorkerMetrics(live), obsLogLine(live)]) {
      expect(out).not.toMatch(/https?:|wss?:|SECRETKEY123|rpc\.example/);
    }
  });
});

describe('obsLogLine', () => {
  it('has a bounded key set', () => {
    const line = obsLogLine(observe(() => [stats({ byPriority: { 0: 1 } })]));
    expect(line.startsWith('[obs] ')).toBe(true);
    const body = JSON.parse(line.slice(6));
    expect(Object.keys(body)).toEqual(['rpc', 'memMb', 'uptimeS']);
    expect(Object.keys(body.rpc)).toEqual([...TIERS]);
    expect(body.rpc.watcher).toEqual([1, 0, 0, 0, 0]);
    expect(Object.keys(body.memMb)).toEqual(['rss', 'heapUsed', 'heapTotal', 'maxRss']);
  });
});

describe('worker health server', () => {
  let server: ReturnType<typeof startHealthServer> | undefined;
  afterEach(() => server?.close());

  const get = async (path: string) => {
    server = startHealthServer(0, () => 'tripwire_worker_uptime_seconds 1\n');
    await new Promise((r) => server!.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
  };

  it('/health answers exactly as before (constant liveness)', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"ok":true,"service":"launch-auditor-worker"}');
  });

  it('/metrics serves Prometheus text', async () => {
    const r = await get('/metrics');
    expect(r.status).toBe(200);
    expect(r.type).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(r.body).toBe('tripwire_worker_uptime_seconds 1\n');
  });

  it('a throwing metrics reader yields a fixed 503 and /health on the same server is untouched', async () => {
    server = startHealthServer(0, () => {
      throw new Error('boom https://rpc.example/v1/SECRETKEY123');
    });
    await new Promise((r) => server!.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const m = await fetch(`http://127.0.0.1:${port}/metrics`);
    const mBody = await m.text();
    expect(m.status).toBe(503);
    expect(m.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(mBody).toBe('metrics unavailable\n');
    expect(mBody).not.toMatch(/boom|https?:|SECRETKEY123|rpc\.example/);
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    expect(h.status).toBe(200);
    expect(await h.text()).toBe('{"ok":true,"service":"launch-auditor-worker"}');
  });

  it('other paths stay 404', async () => {
    expect((await get('/nope')).status).toBe(404);
  });
});
