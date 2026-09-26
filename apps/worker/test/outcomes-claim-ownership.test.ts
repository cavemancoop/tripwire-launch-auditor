import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Package 4b (review d17cd0c4): row ownership. Overlapping sweepers selected the
// same PENDING rows and wrote by id alone, so one attempt could overwrite
// another's terminal result or retry evidence. The real sweepDueOutcomes runs
// here against a small in-memory Outcome table whose updateMany evaluates the
// WHERE and applies the change in one synchronous step — the single-statement
// guarantee Postgres gives a conditional UPDATE. Filters the fake does not model
// throw, so a query shape it cannot judge fails the test instead of passing.
type Row = {
  id: string;
  label: string;
  horizon: string;
  tokenAddress: string;
  evidence: unknown;
  status: string;
  value: unknown;
  horizonAt: Date;
  measuredAt: Date | null;
  claimToken: string | null;
  claimExpiresAt: Date | null;
};
type Where = Record<string, unknown>;

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  reads: 0,
  /** while set, findMany answers from the table as it was, then waits here (a stale read) */
  readGate: null as Promise<void> | null,
  /** resolver calls, as `${sweeper}:${rowId}` */
  calls: [] as string[],
  /** per-sweeper resolver hold and outcome */
  hold: {} as Record<string, Promise<void>>,
  result: {} as Record<string, (rowId: string) => unknown>,
}));

const time = (v: unknown) => (v instanceof Date ? v.getTime() : v);

function matches(row: Record<string, unknown>, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(cond as Where[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (!(key in row)) throw new Error(`fake outcome table: unsupported filter ${key}`);
    const v = time(row[key]);
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if (v !== time(cond)) return false;
      continue;
    }
    for (const [op, raw] of Object.entries(cond as Record<string, unknown>)) {
      const x = time(raw) as number;
      const ok =
        op === 'lt' ? v !== null && (v as number) < x
        : op === 'lte' ? v !== null && (v as number) <= x
        : op === 'gt' ? v !== null && (v as number) > x
        : op === 'in' ? (raw as unknown[]).includes(v)
        : op === 'notIn' ? !(raw as unknown[]).includes(v)
        : (() => {
            throw new Error(`fake outcome table: unsupported operator ${op}`);
          })();
      if (!ok) return false;
    }
  }
  return true;
}

vi.mock('@launch-auditor/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    $transaction: async function (fn: (tx: unknown) => Promise<unknown>) {
      return fn({ outcome: this.outcome, $queryRaw: async () => [{ dbNow: new Date() }] });
    },
    outcome: {
      findMany: async (args: { where: Where; take: number; orderBy: Record<string, string> }) => {
        st.reads++;
        const hits = st.rows
          .filter((r) => matches(r, args.where))
          .sort((a, b) => a.horizonAt.getTime() - b.horizonAt.getTime())
          .slice(0, args.take)
          .map((r) => ({ ...r }));
        if (st.readGate) await st.readGate;
        return hits;
      },
      updateMany: async (args: { where: Where; data: Record<string, unknown> }) => {
        // evaluate and apply with no await between: one statement
        const hit = st.rows.filter((r) => matches(r, args.where));
        for (const r of hit) Object.assign(r, args.data);
        return { count: hit.length };
      },
    },
  },
}));

vi.mock('../src/outcomes/resolve', () => ({
  resolveOneOutcome: async (client: { name: string }, row: { id: string }) => {
    st.calls.push(`${client.name}:${row.id}`);
    if (st.hold[client.name]) await st.hold[client.name];
    const r = st.result[client.name];
    return r ? r(row.id) : { status: 'RESOLVED', value: true, evidence: { by: client.name } };
  },
}));

const { sweepDueOutcomes, OUTCOME_LEASE_MS } = await import('../src/outcomes/loop');

const T0 = Date.parse('2026-09-26T00:00:00Z');
const sweeper = (name: string) => ({ name }) as never;

const pending = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  label: 'TRADING_ALIVE',
  horizon: '24h',
  tokenAddress: `0x${id}`,
  evidence: null,
  status: 'PENDING',
  value: null,
  horizonAt: new Date(T0 - 3_600_000),
  measuredAt: null,
  claimToken: null,
  claimExpiresAt: null,
  ...extra,
});

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

const rowById = (id: string) => st.rows.find((r) => r.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  st.rows = [];
  st.reads = 0;
  st.readGate = null;
  st.calls = [];
  st.hold = {};
  st.result = {};
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('outcome row ownership (Package 4b, review d17cd0c4)', () => {
  it('the lease outlives the resolution deadline', () => {
    expect(OUTCOME_LEASE_MS).toBeGreaterThan(120_000);
  });

  it('two sweepers reading the same rows: each row is claimed, resolved and written exactly once', async () => {
    st.rows = [pending('r1'), pending('r2'), pending('r3')];
    const gate = deferred();
    st.readGate = gate.promise;

    const a = sweepDueOutcomes(sweeper('A'), 25, { concurrency: 3 });
    const b = sweepDueOutcomes(sweeper('B'), 25, { concurrency: 3 });
    await vi.waitFor(() => expect(st.reads).toBe(2));
    gate.release(); // both now hold all three rows from the same read
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.picked).toBe(3);
    expect(rb.picked).toBe(3);
    // no row reached a second resolver: no RPC was spent twice
    expect(st.calls).toHaveLength(3);
    expect(new Set(st.calls.map((c) => c.split(':')[1]))).toEqual(new Set(['r1', 'r2', 'r3']));
    expect(ra.resolved + rb.resolved).toBe(3);
    expect((ra.claimSkipped ?? 0) + (rb.claimSkipped ?? 0)).toBe(3);
    expect((ra.lostClaim ?? 0) + (rb.lostClaim ?? 0)).toBe(0);
    for (const r of st.rows) {
      expect(r).toMatchObject({ status: 'RESOLVED', value: true, claimToken: null, claimExpiresAt: null });
      // the stored result is the claimant's own
      expect(st.calls).toContain(`${(r.evidence as { by: string }).by}:${r.id}`);
    }
  });

  it('a row resolved or deferred since a stale read is not claimed again', async () => {
    st.rows = [pending('done'), pending('retry')];
    const gate = deferred();
    st.readGate = gate.promise;
    const b = sweepDueOutcomes(sweeper('B'), 25, {}); // reads both rows, then waits
    await vi.waitFor(() => expect(st.reads).toBe(1));
    st.readGate = null;

    // A works both rows while B's read is stale: one graded, one deferred
    st.result.A = (id) =>
      id === 'done' ? { status: 'RESOLVED', value: true, evidence: { by: 'A' } } : Promise.reject(new Error('fetch failed'));
    const ra = await sweepDueOutcomes(sweeper('A'), 25, {});
    expect(ra).toMatchObject({ resolved: 1, retryLater: 1 });
    const retryEvidence = structuredClone(rowById('retry').evidence);
    expect(retryEvidence).toMatchObject({ deferrals: 1 });

    gate.release();
    const rb = await b;
    expect(rb).toMatchObject({ picked: 2, resolved: 0, retryLater: 0, claimSkipped: 2, lostClaim: 0 });
    expect(st.calls.filter((c) => c.startsWith('B:'))).toEqual([]);
    expect(rowById('done')).toMatchObject({ status: 'RESOLVED', evidence: { by: 'A' } });
    expect(rowById('retry').evidence).toEqual(retryEvidence);
    expect(rowById('retry').status).toBe('PENDING');
  });

  it('a crashed owner’s row is skipped while its lease runs, then recovered after expiry', async () => {
    st.rows = [pending('orphan', { claimToken: 'crashed-worker', claimExpiresAt: new Date(T0 + 60_000) })];

    const during = await sweepDueOutcomes(sweeper('A'), 25, {});
    expect(during).toMatchObject({ picked: 0, resolved: 0 });
    expect(st.calls).toEqual([]);
    expect(rowById('orphan')).toMatchObject({ status: 'PENDING', claimToken: 'crashed-worker' });

    vi.setSystemTime(T0 + 60_000); // the lease ends
    const after = await sweepDueOutcomes(sweeper('A'), 25, {});
    expect(after).toMatchObject({ picked: 1, resolved: 1, claimSkipped: 0, lostClaim: 0 });
    expect(st.calls).toEqual(['A:orphan']);
    expect(rowById('orphan')).toMatchObject({ status: 'RESOLVED', value: true, claimToken: null, claimExpiresAt: null });
  });

  it('a stale owner’s result is refused after another sweeper took over, and not counted', async () => {
    st.rows = [pending('r1')];
    const holdA = deferred();
    st.hold.A = holdA.promise;
    st.result.A = () => ({ status: 'RESOLVED', value: true, evidence: { by: 'A' } });
    st.result.B = () => ({ status: 'RESOLVED', value: false, evidence: { by: 'B' } });

    const a = sweepDueOutcomes(sweeper('A'), 25, { leaseMs: 1_000 });
    await vi.waitFor(() => expect(st.calls).toEqual(['A:r1'])); // A owns r1 and is mid-RPC
    expect(rowById('r1').claimToken).toEqual(expect.any(String));

    vi.setSystemTime(T0 + 2_000); // A's lease has expired
    const rb = await sweepDueOutcomes(sweeper('B'), 25, {});
    expect(rb).toMatchObject({ picked: 1, resolved: 1, lostClaim: 0 });

    holdA.release();
    const ra = await a;
    expect(ra).toMatchObject({ picked: 1, resolved: 0, na: 0, unresolvable: 0, retryLater: 0, failed: 0, lostClaim: 1 });
    // B's terminal result stands
    expect(rowById('r1')).toMatchObject({ status: 'RESOLVED', value: false, evidence: { by: 'B' }, claimToken: null });
  });

  it('an expired owner’s deferral is refused even when nobody has reclaimed the row', async () => {
    st.rows = [pending('r1', { evidence: { firstDeferredAt: new Date(T0 - 3_600_000).toISOString(), deferrals: 3 } })];
    const holdA = deferred();
    st.hold.A = holdA.promise;
    st.result.A = () => Promise.reject(new Error('fetch failed'));

    const a = sweepDueOutcomes(sweeper('A'), 25, { leaseMs: 1_000 });
    await vi.waitFor(() => expect(st.calls).toEqual(['A:r1']));
    vi.setSystemTime(T0 + 2_000);
    holdA.release();
    const ra = await a;

    expect(ra).toMatchObject({ retryLater: 0, unresolvable: 0, lostClaim: 1 });
    // the retry evidence and backoff stamp are the row's own, untouched
    expect(rowById('r1')).toMatchObject({ status: 'PENDING', measuredAt: null, evidence: { deferrals: 3 } });
    // the expired claim lapses on its own; the next sweep takes the row
    const next = await sweepDueOutcomes(sweeper('B'), 25, {});
    expect(next).toMatchObject({ picked: 1, resolved: 1 });
  });

  it('counts ownership loss instead of failure when a code-path error cannot write its backoff', async () => {
    st.rows = [pending('r1')];
    const hold = deferred();
    st.hold.A = hold.promise;
    st.result.A = () => Promise.reject(new Error('code-path bug'));
    const a = sweepDueOutcomes(sweeper('A'), 25, { leaseMs: 1_000 });
    await vi.waitFor(() => expect(st.calls).toEqual(['A:r1']));
    vi.setSystemTime(T0 + 2_000);
    hold.release();
    const result = await a;
    expect(result).toMatchObject({ failed: 0, lostClaim: 1, retryLater: 0 });
    expect(rowById('r1')).toMatchObject({ status: 'PENDING', measuredAt: null });
  });
});
