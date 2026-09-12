/**
 * M7 — periodic benchmark snapshot. `GET /v1/benchmark` is served by the API
 * process, which has no scoring compute of its own (deliberately — it's the
 * lightweight, publicly-facing half). The worker recomputes the benchmark
 * every tick and writes it to a shared file; the API just reads the latest
 * one. This is the fork-and-run model: one filesystem, no network hop.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runScorer } from './benchmark';
import type { StopSignal } from '../watcher/poller';

export interface ScorerLoopOptions {
  intervalMs?: number;
  outFile?: string;
}

export async function runScorerLoop(
  signal: StopSignal,
  opts: ScorerLoopOptions = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 300_000; // 5 min — matches the commit cadence
  const outFile = opts.outFile ?? 'data/benchmark.json';
  mkdirSync(dirname(outFile), { recursive: true });

  // eslint-disable-next-line no-console
  console.log(`[scorer] snapshot loop every ${intervalMs / 1000}s → ${outFile}`);
  while (!signal.stopped) {
    try {
      const { benchmark, rowCount } = await runScorer({ out: outFile });
      // eslint-disable-next-line no-console
      console.log(`[scorer] snapshot: ${rowCount} rows, ${benchmark.sections.length} sections → ${outFile}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[scorer] snapshot failed', err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
