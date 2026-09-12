import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { Benchmark } from '@launch-auditor/scoring';
import { runScorerLoop, type BenchmarkSnapshot } from '../src/scorer/loop';
import type { StopSignal } from '../src/watcher/poller';

const fakeBenchmark = (n: number): Benchmark => ({
  generatedAt: '2026-09-12T00:00:00.000Z',
  thresholds: [0.5],
  minForMetrics: 100,
  minForClaims: 200,
  sections: [
    {
      splitBy: 'all',
      splitValue: 'all',
      byOutcome: {
        'INSIDER_EXIT@24h': [
          {
            forecaster: 'det_v0',
            n,
            positives: Math.floor(n / 10),
            baseRate: 0.1,
            auroc: 0.6,
            auprc: 0.2,
            logLoss: 0.3,
            brier: 0.1,
            brierSkill: 0.1,
            ece: 0.02,
            pr: [],
            insufficientSample: n < 100,
            comparisons: [],
          },
        ],
      },
    },
  ],
});

let outFile: string | undefined;

afterEach(() => {
  if (outFile && existsSync(outFile)) rmSync(outFile);
  outFile = undefined;
});

describe('runScorerLoop', () => {
  it('writes both the all-inclusive and live-only benchmark, and stops on signal', async () => {
    outFile = join(tmpdir(), `benchmark-loop-test-${Date.now()}.json`);
    const signal: StopSignal = { stopped: false };
    const calls: Array<string | undefined> = [];
    const persisted: BenchmarkSnapshot[] = [];

    await runScorerLoop(signal, {
      outFile,
      intervalMs: 1,
      scorer: async (opts) => {
        calls.push(opts.scope);
        signal.stopped = true; // stop after this one tick
        const n = opts.scope === 'live' ? 80 : 120;
        return { benchmark: fakeBenchmark(n), rowCount: n };
      },
      persist: async (s) => void persisted.push(s),
    });

    expect(calls).toEqual([undefined, 'live']);
    expect(existsSync(outFile)).toBe(true);

    const snapshot = JSON.parse(readFileSync(outFile, 'utf8')) as BenchmarkSnapshot;
    expect(snapshot.all.sections[0]!.byOutcome['INSIDER_EXIT@24h']![0]!.n).toBe(120);
    expect(snapshot.live.sections[0]!.byOutcome['INSIDER_EXIT@24h']![0]!.n).toBe(80);
    expect(typeof snapshot.generatedAt).toBe('string');
  });

  it('persists the same snapshot to the injected store (M9: Postgres, not only the file)', async () => {
    outFile = join(tmpdir(), `benchmark-loop-persist-test-${Date.now()}.json`);
    const signal: StopSignal = { stopped: false };
    const persisted: BenchmarkSnapshot[] = [];

    await runScorerLoop(signal, {
      outFile,
      intervalMs: 1,
      scorer: async (opts) => {
        signal.stopped = true;
        const n = opts.scope === 'live' ? 5 : 9;
        return { benchmark: fakeBenchmark(n), rowCount: n };
      },
      persist: async (s) => void persisted.push(s),
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.all.sections[0]!.byOutcome['INSIDER_EXIT@24h']![0]!.n).toBe(9);
    expect(persisted[0]!.live.sections[0]!.byOutcome['INSIDER_EXIT@24h']![0]!.n).toBe(5);

    const fileSnapshot = JSON.parse(readFileSync(outFile, 'utf8')) as BenchmarkSnapshot;
    expect(fileSnapshot).toEqual(persisted[0]);
  });

  it('creates the output directory if it does not exist yet', async () => {
    const dir = join(tmpdir(), `scorer-loop-mkdir-test-${Date.now()}`);
    outFile = join(dir, 'nested', 'benchmark.json');
    const signal: StopSignal = { stopped: false };

    await runScorerLoop(signal, {
      outFile,
      intervalMs: 1,
      scorer: async (opts) => {
        signal.stopped = true;
        return { benchmark: fakeBenchmark(1), rowCount: 1 };
      },
      persist: async () => {},
    });

    expect(existsSync(outFile)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
    outFile = undefined;
  });
});
