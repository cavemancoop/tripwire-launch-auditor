import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { Benchmark } from '@launch-auditor/scoring';
import { defaultWorkerMetrics } from '../src/health-server';
import {
  formatLoopMetrics,
  LOOPS,
  LoopMetrics,
  OUTCOME_LABELS,
  ROW_RESULTS,
  type LoopObserver,
} from '../src/loop-metrics';
import { runOutcomesLoop, type SweepResult } from '../src/outcomes/loop';
import { runScorerLoop, type BenchmarkSnapshot } from '../src/scorer/loop';

const samples = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#'));
const sweepResult = (over: Partial<SweepResult> = {}): SweepResult => ({
  picked: 0,
  pickedByLabel: {},
  resolved: 0,
  na: 0,
  unresolvable: 0,
  retryLater: 0,
  failed: 0,
  ...over,
});
const throwingObserver: LoopObserver = {
  outcomeSweep: () => {
    throw new Error('observer broke');
  },
  scorerPass: () => {
    throw new Error('observer broke');
  },
};

/** Run the outcomes loop over a scripted list of sweeps (a value returns, an Error throws). */
async function runSweeps(script: Array<SweepResult | Error>, observer: LoopObserver, stepMs = 2_500) {
  const signal = { stopped: false };
  let t = 1_000_000;
  const calls: unknown[] = [];
  await runOutcomesLoop({} as never, signal, {
    intervalMs: 1,
    batch: 7,
    concurrency: 3,
    qualifiedOnly: false,
    observer,
    now: () => t,
    sweep: async (_client, limit, filter) => {
      calls.push({ limit, filter });
      const next = script[calls.length - 1]!;
      if (calls.length >= script.length) signal.stopped = true;
      t += stepMs;
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { calls, endMs: t };
}

describe('formatLoopMetrics', () => {
  it('emits exactly 21 fixed series with only the fixed label sets', () => {
    const text = formatLoopMetrics(new LoopMetrics().snapshot());
    const lines = samples(text);
    expect(lines).toHaveLength(21);
    for (const l of lines) expect(l.endsWith(' 0')).toBe(true);
    const labels = new Set(lines.flatMap((l) => [...l.matchAll(/(\w+)="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`)));
    const allowed = new Set([
      ...OUTCOME_LABELS.map((k) => `label=${k}`),
      ...ROW_RESULTS.map((k) => `result=${k}`),
      ...LOOPS.map((k) => `loop=${k}`),
    ]);
    for (const l of labels) expect(allowed.has(l)).toBe(true);
  });

  it('an unknown label is folded into other, so the series count never grows', () => {
    const m = new LoopMetrics();
    m.outcomeSweep(10, sweepResult({ picked: 2, pickedByLabel: { SOMETHING_NEW: 1, '0xdeadbeef': 1 } }), 0);
    const text = formatLoopMetrics(m.snapshot());
    expect(samples(text)).toHaveLength(21);
    expect(text).toContain('tripwire_worker_outcome_picked_total{label="other"} 2');
    expect(text).not.toMatch(/SOMETHING_NEW|0xdeadbeef/);
  });

  it('the /metrics default carries the 38 process series plus the 21 loop series', () => {
    const text = defaultWorkerMetrics();
    expect(samples(text)).toHaveLength(38 + 21);
    expect(text).toContain('tripwire_worker_rpc_started_total{tier="watcher"}');
    expect(text).toContain('tripwire_worker_loop_last_success_timestamp_seconds{loop="scorer"}');
  });
});

describe('runOutcomesLoop — Package 2b observation', () => {
  it('an empty sweep counts as a successful pass with no picks', async () => {
    const m = new LoopMetrics();
    const { endMs } = await runSweeps([sweepResult()], m);
    const s = m.snapshot();
    expect(s.sweeps).toBe(1);
    expect(s.sweepErrors).toBe(0);
    expect(s.lastSweepSeconds).toBe(2.5);
    expect(Object.values(s.picked).every((n) => n === 0)).toBe(true);
    expect(Object.values(s.rows).every((n) => n === 0)).toBe(true);
    expect(s.iterations.outcomes).toBe(1);
    expect(s.lastSuccessSeconds.outcomes).toBe(endMs / 1000);
    expect(s.iterations.scorer).toBe(0);
  });

  it('a populated sweep adds its label split and row results', async () => {
    const m = new LoopMetrics();
    await runSweeps(
      [
        sweepResult({ picked: 5, pickedByLabel: { INSIDER_EXIT: 3, DRAWDOWN_80: 2 }, resolved: 2, na: 1, retryLater: 1, failed: 1 }),
        sweepResult({ picked: 2, pickedByLabel: { INSIDER_EXIT: 1, TRADING_ALIVE: 1 }, unresolvable: 2 }),
      ],
      m,
    );
    const s = m.snapshot();
    expect(s.sweeps).toBe(2);
    expect(s.sweepSecondsSum).toBe(5);
    expect(s.picked).toEqual({ INSIDER_EXIT: 4, SELL_IMPAIRED: 0, LIQ_IMPAIRED: 0, DRAWDOWN_80: 2, TRADING_ALIVE: 1, other: 0 });
    expect(s.rows).toEqual({ resolved: 2, na: 1, unresolvable: 2, retry: 1, failed: 1 });
  });

  it('a thrown sweep counts an error and does not advance last success', async () => {
    const m = new LoopMetrics();
    let successAt = 0;
    const spy: LoopObserver = {
      outcomeSweep: (ms, r, at) => {
        if (r) successAt = at;
        m.outcomeSweep(ms, r, at);
      },
      scorerPass: (ok, at) => m.scorerPass(ok, at),
    };
    await runSweeps([sweepResult({ picked: 1, pickedByLabel: { SELL_IMPAIRED: 1 }, resolved: 1 }), new Error('db down')], spy);
    const s = m.snapshot();
    expect(s.sweeps).toBe(2);
    expect(s.sweepErrors).toBe(1);
    expect(s.iterations.outcomes).toBe(2);
    expect(s.errors.outcomes).toBe(1);
    expect(successAt).toBeGreaterThan(0);
    expect(s.lastSuccessSeconds.outcomes).toBe(successAt / 1000);
    expect(s.lastSweepSeconds).toBe(2.5); // a failed sweep's duration is still recorded
    expect(s.rows.resolved).toBe(1); // nothing is counted from the thrown sweep
  });

  it('a throwing observer changes nothing: same sweeps, same arguments, loop still stops cleanly', async () => {
    const script = () => [sweepResult({ picked: 1, pickedByLabel: { LIQ_IMPAIRED: 1 }, na: 1 }), new Error('db down'), sweepResult()];
    const ok = await runSweeps(script(), new LoopMetrics());
    const broken = await runSweeps(script(), throwingObserver);
    expect(broken.calls).toHaveLength(3);
    expect(broken.calls).toEqual(ok.calls);
    expect(ok.calls[0]).toEqual({ limit: 7, filter: { order: 'fair', concurrency: 3, qualifiedOnly: false } });
  });
});

const fakeBenchmark = (): Benchmark => ({
  generatedAt: '2026-09-24T00:00:00.000Z',
  thresholds: [0.5],
  minForMetrics: 100,
  minForClaims: 200,
  minPositivesForClaims: 30,
  sections: [],
});

const outFiles: string[] = [];
afterEach(() => {
  for (const f of outFiles.splice(0)) if (existsSync(f)) rmSync(f);
});

/** Run the scorer loop for `passes` passes; `failOn` lists the pass numbers whose persist throws. */
async function runPasses(passes: number, observer: LoopObserver, failOn: number[] = []) {
  const outFile = join(tmpdir(), `loop-metrics-scorer-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  outFiles.push(outFile);
  const signal = { stopped: false };
  let t = 5_000_000;
  let pass = 0;
  const persisted: BenchmarkSnapshot[] = [];
  await runScorerLoop(signal, {
    outFile,
    intervalMs: 1,
    observer,
    now: () => t,
    scorer: async (opts) => {
      if (opts.scope === undefined) {
        pass++;
        t += 1_000;
        if (pass >= passes) signal.stopped = true;
      }
      return { benchmark: fakeBenchmark(), rowCount: 1 };
    },
    readCoverage: async () => ({}),
    persist: async (s) => {
      if (failOn.includes(pass)) throw new Error('postgres unavailable');
      persisted.push(s);
    },
  });
  return { persisted, file: outFile };
}

describe('runScorerLoop — Package 2b observation', () => {
  it('a completed pass counts an iteration and sets last success', async () => {
    const m = new LoopMetrics();
    await runPasses(1, m);
    const s = m.snapshot();
    expect(s.iterations.scorer).toBe(1);
    expect(s.errors.scorer).toBe(0);
    expect(s.lastSuccessSeconds.scorer).toBe(5_001);
    expect(s.iterations.outcomes).toBe(0);
  });

  it('a failed pass counts an error and leaves last success at the previous completed pass', async () => {
    const m = new LoopMetrics();
    await runPasses(3, m, [2, 3]);
    const s = m.snapshot();
    expect(s.iterations.scorer).toBe(3);
    expect(s.errors.scorer).toBe(2);
    expect(s.lastSuccessSeconds.scorer).toBe(5_001);
  });

  it('a failure before any success leaves last success at 0 (never)', async () => {
    const m = new LoopMetrics();
    await runPasses(1, m, [1]);
    expect(m.snapshot().lastSuccessSeconds.scorer).toBe(0);
    expect(m.snapshot().errors.scorer).toBe(1);
  });

  it('a throwing observer changes nothing: same snapshots persisted and written', async () => {
    const ok = await runPasses(2, new LoopMetrics(), [1]);
    const broken = await runPasses(2, throwingObserver, [1]);
    expect(broken.persisted).toHaveLength(1);
    expect(broken.persisted.map((s) => ({ ...s, generatedAt: '' }))).toEqual(
      ok.persisted.map((s) => ({ ...s, generatedAt: '' })),
    );
    expect(JSON.parse(readFileSync(broken.file, 'utf8'))).toEqual(broken.persisted[0]);
  });
});
