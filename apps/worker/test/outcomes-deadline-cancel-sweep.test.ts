import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Package 4b (review d17cd0c4): the outcome sweep runs each row's resolution
// under a cancellable deadline. When it fires the row is deferred, the late
// result is never written, and the scan issues no further provider request.
// Before this, withDeadline gave up on the row while the scan ran on to its last
// chunk, spending budget on a result nobody would read. The real sweep, real
// budgeted viem transport, real chunked log scan and real scheduler run here;
// Postgres and fetch are stubbed.
type Row = { id: string; label: string; horizon: string; tokenAddress: string; evidence: unknown };
type Update = { where: { id: string }; data: Record<string, unknown> };

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  updates: [] as Update[],
  scansFinished: 0,
}));

vi.mock('@launch-auditor/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    $transaction: async function (fn: (tx: unknown) => Promise<unknown>) {
      return fn({ outcome: this.outcome, $queryRaw: async () => [{ dbNow: new Date() }] });
    },
    outcome: {
      findMany: async (args: { where: { label?: string }; take: number }) =>
        st.rows.filter((r) => r.label === args.where.label).slice(0, args.take),
      // Package 4b: every claim succeeds; the owner-guarded writes are the row's result
      updateMany: async (args: Update) => {
        if (typeof args.data.claimToken !== 'string') st.updates.push(args);
        return { count: 1 };
      },
    },
  },
}));

// a resolver whose one pool scan is ten 10-block eth_getLogs chunks, then a verdict
vi.mock('../src/outcomes/resolve', async () => {
  const { getLogsChunked } = await import('@launch-auditor/chain');
  return {
    resolveOneOutcome: async (client: { request: never }) => {
      await getLogsChunked(client, { fromBlock: 0n, toBlock: 99n, maxRange: 10 });
      st.scansFinished++;
      return { status: 'RESOLVED', value: 1, evidence: { late: true } };
    },
  };
});

const { sweepDueOutcomes } = await import('../src/outcomes/loop');
const { budgetedHttp, RequestScheduler, resetRpcWireStats, rpcOutcomeCellStats } = await import('@launch-auditor/rpc-budget');
const { createPublicClient } = await import('viem');

/** every eth_getLogs answers after 25 s (under the transport's 30 s timeout) */
const CHUNK_MS = 25_000;
const DEADLINE_MS = 120_000;
let fetches = 0;

beforeEach(() => {
  st.rows = [];
  st.updates = [];
  st.scansFinished = 0;
  fetches = 0;
  resetRpcWireStats();
  vi.stubGlobal('fetch', async () => {
    fetches++;
    await new Promise((r) => setTimeout(r, CHUNK_MS));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sweepDueOutcomes — a timed-out row stops its RPC (Package 4b)', () => {
  it('defers the row at the deadline, sends no further chunk and never writes the late result', async () => {
    vi.useFakeTimers();
    const scheduler = new RequestScheduler({ rpm: 6_000_000 });
    const client = createPublicClient({
      transport: budgetedHttp('http://rpc.test', { scheduler, priority: 2, chainId: 4663 }),
    });
    st.rows = [{ id: 'slow', label: 'TRADING_ALIVE', horizon: '24h', tokenAddress: '0xslow', evidence: null }];

    const sweep = sweepDueOutcomes(client as never, 25, { order: 'fair' });
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    const r = await sweep;

    // chunks start at 0, 25, 50, 75 and 100 s; the fifth is in flight at the deadline
    expect(fetches).toBe(5);
    expect(rpcOutcomeCellStats()).toEqual({ 'live:TRADING_ALIVE@24h:unknown': 4 });
    expect(r).toMatchObject({ picked: 1, resolved: 0, unresolvable: 0, retryLater: 1, failed: 0 });
    expect(st.updates).toHaveLength(1);
    const d = st.updates[0]!.data;
    expect(d.status).toBeUndefined();
    expect(d.evidence).toMatchObject({ firstDeferredAt: expect.any(String), deferrals: 1 });
    expect((d.evidence as { lastError: string }).lastError).toMatch(/deadline of 120000ms exceeded/);

    // without cancellation the scan would run on to all ten chunks and a verdict
    await vi.advanceTimersByTimeAsync(10 * CHUNK_MS);
    expect(fetches).toBe(5); // the in-flight chunk settled in its slot; the sixth never started
    expect(rpcOutcomeCellStats()).toEqual({ 'live:TRADING_ALIVE@24h:unknown': 5 });
    expect(scheduler.stats.cancelled).toBe(1);
    expect(scheduler.stats.inFlight).toBe(0);
    expect(st.scansFinished).toBe(0);
    expect(st.updates).toHaveLength(1); // no late RESOLVED write
  });
});
