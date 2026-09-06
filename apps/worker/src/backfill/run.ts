import {
  POOL_EVENT_TOPIC0,
  getGetLogsMaxRange,
  poolCreationSources,
  setGetLogsMaxRange,
} from '@launch-auditor/chain';
import { prisma } from '@launch-auditor/db';
import { budgetStats, getBudgetedClient, PRIORITY, probeGetLogsRange } from '@launch-auditor/rpc-budget';
import type { PublicClient } from 'viem';
import { loadEnv } from '../env';
import { blockAtTime } from '../outcomes/block-time';
import { sweepDueOutcomes, type SweepResult } from '../outcomes/loop';
import { detectPools } from '../watcher/detect';
import { ingestPool } from '../watcher/ingest';
import { runT10ForLaunch } from '../watcher/t10';

export interface BackfillOptions {
  /** window length in days of chain history (spec §7; checkpoint cut 45 -> 14) */
  days: number;
  /** hard cap on RPC calls for this run; 0 = unbounded */
  maxCalls: number;
  dryRun?: boolean;
  fromBlock?: bigint;
  toBlock?: bigint;
  /** heavy scans (cluster / INSIDER / SELL / LIQ) on qualified launches only */
  qualifiedOnly?: boolean;
  /** skip pool discovery + ingest; just run T+10m + outcomes on existing retrospective rows */
  resolveOnly?: boolean;
  /** stop after discovery + features, before outcome resolution */
  featuresOnly?: boolean;
  log?: (msg: string) => void;
}

export interface BackfillResult {
  window: { fromBlock: number; toBlock: number; days: number };
  estimatedCalls: number;
  launchesIngested: number;
  t10Ran: number;
  t10Failed: number;
  outcomes: SweepResult;
  callsUsed: number;
  stoppedEarly: boolean;
}

const emptySweep = (): SweepResult => ({
  picked: 0,
  resolved: 0,
  na: 0,
  unresolvable: 0,
  retryLater: 0,
  failed: 0,
});

export async function runBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const { rpcUrl, chainId, headLagBlocks, rpcMaxGetLogsRange } = loadEnv();
  const client = getBudgetedClient(rpcUrl, { priority: PRIORITY.backfill }) as PublicClient;
  const qualifiedOnly = opts.qualifiedOnly ?? true;

  // getLogs span
  const head = await client.getBlockNumber();
  if (rpcMaxGetLogsRange > 0) {
    setGetLogsMaxRange(rpcMaxGetLogsRange);
  } else {
    try {
      const { v4PoolManager } = poolCreationSources(chainId);
      const probe = probeGetLogsRange((a) => client.request(a as never) as Promise<unknown>, {
        address: v4PoolManager,
        anchorBlock: head - 5n,
        candidates: [10_000, 5_000, 2_000],
        topics: [POOL_EVENT_TOPIC0.v4Initialize], // sparse — an unfiltered scan can hang the RPC
      });
      const timeout = new Promise<number>((_, rej) =>
        setTimeout(() => rej(new Error('probe timeout')), 25_000),
      );
      setGetLogsMaxRange(await Promise.race([probe, timeout]));
    } catch (err) {
      log(`[backfill] getLogs-range probe skipped (${(err as Error).message}); using ${getGetLogsMaxRange(chainId)}`);
    }
  }
  const maxRange = getGetLogsMaxRange(chainId);

  const toBlock = opts.toBlock ?? (head > headLagBlocks ? head - headLagBlocks : head);
  const fromBlock =
    opts.fromBlock ??
    (await blockAtTime(client, new Date(Date.now() - opts.days * 86_400_000), { chainId }));

  const spanBlocks = toBlock > fromBlock ? Number(toBlock - fromBlock) : 0;
  const expectedLaunches = Math.max(1, Math.round(opts.days * 180));
  const estimatedCalls =
    Math.ceil(spanBlocks / maxRange) * 3 + // v2 + v3 + v4 discovery scans
    expectedLaunches * 40 + // freshness + index + T+10m features
    expectedLaunches * 80 + // DRAWDOWN price series
    Math.round(expectedLaunches * 0.3) * 250; // cluster / INSIDER / SELL for the qualified ~30%

  log(
    `[backfill] window blocks ${fromBlock}..${toBlock} (${opts.days}d, ~${spanBlocks} blocks), ` +
      `getLogs span ${maxRange}, est. RPC calls ~${estimatedCalls.toLocaleString()}` +
      (opts.maxCalls > 0 ? `, cap ${opts.maxCalls.toLocaleString()}` : ', uncapped'),
  );

  const result: BackfillResult = {
    window: { fromBlock: Number(fromBlock), toBlock: Number(toBlock), days: opts.days },
    estimatedCalls,
    launchesIngested: 0,
    t10Ran: 0,
    t10Failed: 0,
    outcomes: emptySweep(),
    callsUsed: 0,
    stoppedEarly: false,
  };
  if (opts.dryRun) {
    log('[backfill] dry run — not executing');
    return result;
  }

  const startCalls = budgetStats(rpcUrl).started;
  const used = (): number => budgetStats(rpcUrl).started - startCalls;
  const overBudget = (): boolean => opts.maxCalls > 0 && used() >= opts.maxCalls;

  // ── 1. discovery + ingest ────────────────────────────────────────────
  const launchIds: string[] = [];
  if (!opts.resolveOnly) {
    for (let from = fromBlock; from <= toBlock && !overBudget(); from += BigInt(maxRange)) {
      const to = from + BigInt(maxRange) - 1n < toBlock ? from + BigInt(maxRange) - 1n : toBlock;
      let detected;
      try {
        detected = await detectPools(client, chainId, from, to, maxRange);
      } catch (err) {
        log(`[backfill] discovery ${from}..${to} failed: ${(err as Error).message.split('\n')[0]}`);
        continue;
      }
      for (const dp of detected) {
        if (overBudget()) break;
        try {
          const id = await ingestPool(dp, {
            client,
            chainId,
            quotaPerCreator24h: loadEnv().quotaPerCreator24h,
            retrospective: true,
            enqueueT10: async () => {},
          });
          if (id) {
            launchIds.push(id);
            result.launchesIngested++;
          }
        } catch (err) {
          log(`[backfill] ingest ${dp.txHash} failed: ${(err as Error).message.split('\n')[0]}`);
        }
      }
      if (detected.length) log(`[backfill] ${from}..${to}: +${result.launchesIngested} launches, ${used()} calls`);
    }
  }

  // ── 2. T+10m features (frozen code) ─────────────────────────────────
  const toFeature = opts.resolveOnly
    ? (
        await prisma.launch.findMany({
          where: { retrospective: true, feature: { t10ComputedAt: null } },
          select: { id: true },
        })
      ).map((l) => l.id)
    : launchIds;

  for (const id of toFeature) {
    if (overBudget()) {
      result.stoppedEarly = true;
      break;
    }
    try {
      await runT10ForLaunch(client, id);
      result.t10Ran++;
    } catch (err) {
      result.t10Failed++;
      log(`[backfill] T+10m ${id} failed: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  log(`[backfill] features: ${result.t10Ran} ok, ${result.t10Failed} failed, ${used()} calls`);

  // ── 3. outcome resolution ──────────────────────────────────────────
  if (!opts.featuresOnly) {
    let quiet = 0;
    while (!overBudget() && quiet < 2) {
      const r = await sweepDueOutcomes(client, 20, { qualifiedOnly });
      result.outcomes.picked += r.picked;
      result.outcomes.resolved += r.resolved;
      result.outcomes.na += r.na;
      result.outcomes.unresolvable += r.unresolvable;
      result.outcomes.retryLater += r.retryLater;
      result.outcomes.failed += r.failed;
      if (r.picked === 0) quiet++;
      else {
        quiet = 0;
        log(
          `[backfill] outcomes +${r.resolved} resolved / ${r.na} n/a / ${r.unresolvable} unres / ` +
            `${r.retryLater} retry — ${used()} calls`,
        );
      }
    }
  }

  result.callsUsed = used();
  result.stoppedEarly = result.stoppedEarly || overBudget();
  log(
    `[backfill] done — ${result.launchesIngested} ingested, ${result.t10Ran} featured, ` +
      `${result.outcomes.resolved} outcomes resolved, ${result.callsUsed} RPC calls` +
      (result.stoppedEarly ? ' (STOPPED AT CAP)' : ''),
  );
  return result;
}

/** observed base rate per (label, horizon) among RESOLVED retrospective outcomes. */
export async function observedBaseRates(): Promise<
  Array<{ key: string; n: number; positives: number; rate: number }>
> {
  const rows = await prisma.outcome.findMany({
    where: { status: 'RESOLVED', value: { not: null }, retrospective: true },
    select: { label: true, horizon: true, value: true },
  });
  const acc = new Map<string, { n: number; pos: number }>();
  for (const r of rows) {
    const k = `${r.label}@${r.horizon}`;
    const a = acc.get(k) ?? { n: 0, pos: 0 };
    a.n++;
    if (r.value) a.pos++;
    acc.set(k, a);
  }
  return [...acc.entries()]
    .map(([key, a]) => ({ key, n: a.n, positives: a.pos, rate: a.n ? a.pos / a.n : 0 }))
    .sort((x, y) => x.key.localeCompare(y.key));
}
