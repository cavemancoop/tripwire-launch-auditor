/**
 * Package 2a — worker process observation (docs/FABLE-REVIEW-IMPLEMENTATION.md).
 * Read-only snapshots of the shared RPC scheduler(s) by priority tier and of
 * process memory, served as Prometheus text on the private health port and as
 * one `[obs]` log line a minute. Fixed label sets only: never an
 * RPC URL (URLs embed provider keys), address, row id or error message.
 */
import { getHeapStatistics } from 'node:v8';
import { allSchedulerStats, PRIORITY, rpcWireStats, rpcMethodStats, RPC_METHODS, type RpcWireStats, type RpcMethod, type SchedulerStats } from '@launch-auditor/rpc-budget';

export const TIERS = ['watcher', 'commit', 'outcomes', 'assess', 'deepdive', 'backfill', 'other'] as const;
export type Tier = (typeof TIERS)[number];

const TIER_BY_PRIORITY = new Map<number, Tier>(Object.entries(PRIORITY).map(([name, p]) => [p, name as Tier]));
export const tierOf = (priority: number): Tier => TIER_BY_PRIORITY.get(priority) ?? 'other';

export interface TierStats {
  started: number;
  completed: number;
  failed: number;
  queued: number;
  inFlight: number;
}

export const MEMORY_KINDS = ['rss', 'heap_used', 'heap_total', 'external', 'array_buffers'] as const;

export interface WorkerObservation {
  tiers: Record<Tier, TierStats>;
  wire: RpcWireStats;
  methods: Record<RpcMethod, number>;
  memory: Record<(typeof MEMORY_KINDS)[number], number>;
  maxRssBytes: number;
  heapLimitBytes: number;
  uptimeSeconds: number;
}

/** Pure: sum every scheduler's per-priority stats into the fixed tier set. */
export function sumTiers(stats: SchedulerStats[]): Record<Tier, TierStats> {
  const out = Object.fromEntries(
    TIERS.map((t) => [t, { started: 0, completed: 0, failed: 0, queued: 0, inFlight: 0 }]),
  ) as Record<Tier, TierStats>;
  const add = (m: Record<number, number> | undefined, field: keyof TierStats) => {
    for (const [p, n] of Object.entries(m ?? {})) out[tierOf(Number(p))][field] += n;
  };
  for (const s of stats) {
    add(s.byPriority, 'started');
    add(s.completedByPriority, 'completed');
    add(s.failedByPriority, 'failed');
    add(s.queuedByPriority, 'queued');
    add(s.inFlightByPriority, 'inFlight');
  }
  return out;
}

export function observe(schedulers: () => SchedulerStats[] = allSchedulerStats): WorkerObservation {
  const m = process.memoryUsage();
  return {
    tiers: sumTiers(schedulers()),
    wire: rpcWireStats(),
    methods: rpcMethodStats(),
    memory: {
      rss: m.rss,
      heap_used: m.heapUsed,
      heap_total: m.heapTotal,
      external: m.external,
      array_buffers: m.arrayBuffers,
    },
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

const TIER_METRICS: Array<[string, 'counter' | 'gauge', keyof TierStats, string]> = [
  ['rpc_started_total', 'counter', 'started', 'RPC requests admitted by the shared scheduler'],
  ['rpc_completed_total', 'counter', 'completed', 'RPC requests that completed'],
  ['rpc_failed_total', 'counter', 'failed', 'RPC requests that threw'],
  ['rpc_queued', 'gauge', 'queued', 'RPC requests waiting for a token or slot'],
  ['rpc_in_flight', 'gauge', 'inFlight', 'RPC requests currently running'],
];

/** Pure: Prometheus text exposition (0.0.4) of one observation. */
export function formatWorkerMetrics(o: WorkerObservation): string {
  const lines: string[] = [];
  const head = (name: string, type: string, help: string) =>
    lines.push(`# HELP tripwire_worker_${name} ${help}`, `# TYPE tripwire_worker_${name} ${type}`);
  for (const [name, type, field, help] of TIER_METRICS) {
    head(name, type, `${help}, by priority tier`);
    for (const t of TIERS) lines.push(`tripwire_worker_${name}{tier="${t}"} ${o.tiers[t][field]}`);
  }
  for (const [name, help, value] of [
    ['rpc_wire_attempts_total', 'Budgeted public-client transport attempts, including retries; viem may dedupe concurrent fetches', o.wire.attempts],
    ['rpc_wire_provider_failures_total', 'Budgeted transport attempts rejected by quota, rate limit or transport failure', o.wire.providerFailures],
    ['rpc_wire_quota_failures_total', 'Budgeted transport attempts classified as provider quota exhaustion', o.wire.quotaFailures],
  ] as const) {
    head(name, 'counter', help);
    lines.push(`tripwire_worker_${name} ${value}`);
  }
  head('rpc_method_attempts_total', 'counter', 'Budgeted transport attempts including retries, by fixed JSON-RPC method bucket');
  for (const method of RPC_METHODS) lines.push(`tripwire_worker_rpc_method_attempts_total{method="${method}"} ${o.methods[method]}`);
  head('memory_bytes', 'gauge', 'process.memoryUsage() by kind');
  for (const k of MEMORY_KINDS) lines.push(`tripwire_worker_memory_bytes{kind="${k}"} ${o.memory[k]}`);
  head('max_rss_bytes', 'gauge', 'peak resident set size since process start');
  lines.push(`tripwire_worker_max_rss_bytes ${o.maxRssBytes}`);
  head('heap_limit_bytes', 'gauge', 'V8 heap size limit');
  lines.push(`tripwire_worker_heap_limit_bytes ${o.heapLimitBytes}`);
  head('uptime_seconds', 'gauge', 'seconds since the worker process started');
  lines.push(`tripwire_worker_uptime_seconds ${o.uptimeSeconds}`);
  return `${lines.join('\n')}\n`;
}

const mb = (b: number): number => Math.round(b / 1_048_576);

/** Pure: the compact per-minute log line (tier → [started, completed, failed, queued, inFlight]). */
export function obsLogLine(o: WorkerObservation): string {
  const rpc = Object.fromEntries(
    TIERS.map((t) => {
      const s = o.tiers[t];
      return [t, [s.started, s.completed, s.failed, s.queued, s.inFlight]];
    }),
  );
  return `[obs] ${JSON.stringify({
    rpc,
    rpcWire: [o.wire.attempts, o.wire.providerFailures, o.wire.quotaFailures],
    rpcMethods: o.methods,
    memMb: { rss: mb(o.memory.rss), heapUsed: mb(o.memory.heap_used), heapTotal: mb(o.memory.heap_total), maxRss: mb(o.maxRssBytes) },
    uptimeS: o.uptimeSeconds,
  })}`;
}

/** Log one observation line every `intervalMs`; the timer never holds the process open. */
export function startObservationLog(intervalMs = 60_000, log: (line: string) => void = console.log): () => void {
  const timer = setInterval(() => {
    try {
      log(obsLogLine(observe()));
    } catch {
      // observation must never affect the worker
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
