/**
 * M9 — operational alerts (build-guide M9): STARVED, IDS trip, commit lag,
 * watcher stalled, report lag. Edge-triggered: a Telegram message fires only when a
 * check transitions ok->bad or bad->ok, not every tick, so a steady-state
 * problem doesn't spam the channel once per interval forever.
 */
import { prisma } from '@launch-auditor/db';
import { rpcWireStats, type RpcWireStats } from '@launch-auditor/rpc-budget';
import { ProviderHealthTracker } from './provider-health';
import { makeTelegramSender, TelegramSendError } from './telegram/poster';
import type { StopSignal } from './watcher/poller';

export interface AlertCheck {
  key: 'starved' | 'ids_trip' | 'commit_lag' | 'watcher_stalled' | 'report_lag' | 'provider_failure';
  bad: boolean;
  detail: string;
  /** Identity of the report behind the lag sample; repeated reads count once. */
  sampleId?: string;
}

export interface AlertReaders {
  latestLifecycle: () => Promise<{ newState: string; idsMismatch: boolean } | null>;
  latestPhantomEpoch: () => Promise<boolean>;
  latestCommitAt: () => Promise<Date | null>;
  latestWatcherUpdate: () => Promise<Date | null>;
  latestDetReport: () => Promise<{ id: string; createdAt: Date; launchAt: Date | null } | null>;
}

const prismaReaders: AlertReaders = {
  latestLifecycle: () =>
    prisma.lifecycleLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { newState: true, idsMismatch: true },
    }),
  latestPhantomEpoch: async () => {
    const row = await prisma.metabolismEpoch.findFirst({ orderBy: { at: 'desc' }, select: { phantom: true } });
    return row?.phantom ?? false;
  },
  latestCommitAt: async () => {
    const row = await prisma.commit.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    return row?.createdAt ?? null;
  },
  latestWatcherUpdate: async () => {
    const row = await prisma.watcherCursor.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } });
    return row?.updatedAt ?? null;
  },
  latestDetReport: async () => {
    // On-demand reports can hide a late T+10m report; retrospective rows
    // cannot establish live report health.
    const row = await prisma.report.findFirst({
      where: { forecaster: 'det_v0', trigger: 'launch', launch: { is: { retrospective: false } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, launch: { select: { launchAt: true } } },
    });
    return row ? { id: row.id, createdAt: row.createdAt, launchAt: row.launch?.launchAt ?? null } : null;
  },
};

export interface EvaluateAlertsOptions {
  now?: Date;
  /** default 600 (10 min) — spec: "commit lag > 10 min" */
  commitLagSec?: number;
  /** default 300 (5 min) — spec: "watcher stalled > 5 min" */
  watcherStalledSec?: number;
  /** default 900 (15 min); two distinct late live reports are required */
  reportLagSec?: number;
  readers?: AlertReaders;
}

const age = (now: Date, at: Date | null): number | null => (at ? (now.getTime() - at.getTime()) / 1000 : null);

export async function evaluateAlerts(opts: EvaluateAlertsOptions = {}): Promise<AlertCheck[]> {
  const now = opts.now ?? new Date();
  const commitLagSec = opts.commitLagSec ?? 600;
  const watcherStalledSec = opts.watcherStalledSec ?? 300;
  const reportLagSec = opts.reportLagSec ?? 900;
  const readers = opts.readers ?? prismaReaders;

  const [lifecycle, phantom, commitAt, watcherAt, detReport] = await Promise.all([
    readers.latestLifecycle(),
    readers.latestPhantomEpoch(),
    readers.latestCommitAt(),
    readers.latestWatcherUpdate(),
    readers.latestDetReport(),
  ]);

  const starved = lifecycle?.newState === 'STARVED';
  const idsTrip = Boolean(lifecycle?.idsMismatch) || phantom;

  const commitAgeSec = age(now, commitAt);
  const commitLagged = commitAgeSec !== null && commitAgeSec > commitLagSec;

  const watcherAgeSec = age(now, watcherAt);
  const watcherStalled = watcherAgeSec !== null && watcherAgeSec > watcherStalledSec;

  const checks: AlertCheck[] = [
    {
      key: 'starved',
      bad: starved,
      detail: starved
        ? 'metabolism state is STARVED — balance at/under reserve, nothing to serve'
        : 'ok',
    },
    {
      key: 'ids_trip',
      bad: idsTrip,
      detail: idsTrip
        ? 'idsMismatch or a phantom-spend epoch flagged on the latest row'
        : 'ok',
    },
    {
      key: 'commit_lag',
      bad: commitLagged,
      detail:
        commitAgeSec === null
          ? 'no commit batch has ever formed'
          : `${Math.round(commitAgeSec / 60)}min since the last commit batch (threshold ${commitLagSec / 60}min)`,
    },
    {
      key: 'watcher_stalled',
      bad: watcherStalled,
      detail:
        watcherAgeSec === null
          ? 'no watcher cursor yet'
          : `${Math.round(watcherAgeSec / 60)}min since the watcher last advanced (threshold ${watcherStalledSec / 60}min)`,
    },
  ];
  // An old report is not evidence of current lag. A feed-silence check needs
  // an eligible-candidate denominator before it can be truthful.
  if (detReport?.launchAt) {
    const reportAgeSec = age(now, detReport.createdAt)!;
    const lagSec = (detReport.createdAt.getTime() - detReport.launchAt.getTime()) / 1000;
    if (reportAgeSec >= 0 && reportAgeSec <= 20 * 60 && lagSec >= 0) {
      checks.push({
        key: 'report_lag',
        bad: lagSec > reportLagSec,
        detail: `${Math.round(lagSec / 60)}min from launch to newest live det_v0 report (threshold ${reportLagSec / 60}min)`,
        sampleId: detReport.id,
      });
    }
  }
  return checks;
}

const LABELS: Record<AlertCheck['key'], string> = {
  starved: 'STARVED',
  ids_trip: 'IDS trip',
  commit_lag: 'commit lag',
  watcher_stalled: 'watcher stalled',
  report_lag: 'deterministic report lag',
  provider_failure: 'RPC provider failures',
};

export type SendFn = (text: string) => Promise<void>;

export interface AlertStateStore {
  load: () => Promise<Map<AlertCheck['key'], boolean>>;
  save: (key: AlertCheck['key'], bad: boolean) => Promise<void>;
}

const prismaAlertStateStore = (chatId: string): AlertStateStore => {
  // A new destination receives its own first alert, even if the old chat had
  // already been notified. Versioning also prevents changed semantics from
  // silently inheriting an earlier check's state.
  const prefix = `v1:${chatId}:`;
  return {
    load: async () => {
      const rows = await prisma.alertDeliveryState.findMany({
        where: { key: { startsWith: prefix } },
        select: { key: true, lastBad: true },
      });
      return new Map(rows.map((row) => [row.key.slice(prefix.length) as AlertCheck['key'], row.lastBad]));
    },
    save: async (key, bad) => {
      const scopedKey = `${prefix}${key}`;
      await prisma.alertDeliveryState.upsert({
        where: { key: scopedKey },
        create: { key: scopedKey, lastBad: bad },
        update: { lastBad: bad },
      });
    },
  };
};

/** Send each transition, then remember it. Failed sends stay eligible to retry. */
export async function applyAlertTransitions(
  checks: AlertCheck[],
  lastBad: Map<AlertCheck['key'], boolean>,
  send: SendFn,
  persist?: AlertStateStore['save'],
  retryUntil?: Map<AlertCheck['key'], number>,
  now: () => number = Date.now,
): Promise<void> {
  for (const c of checks) {
    const was = lastBad.get(c.key) ?? false;
    if (c.bad === was) { retryUntil?.delete(c.key); continue; }
    if ((retryUntil?.get(c.key) ?? 0) > now()) continue;
    const message = c.bad
      ? `\u{1F6A8} ${LABELS[c.key]}: ${c.detail}`
      : `✅ recovered — ${LABELS[c.key]}: ${c.detail}`;
    try {
      await send(message);
    } catch (err) {
      console.error('[alerts] send failed', err instanceof Error ? err.message : err);
      if (err instanceof TelegramSendError && (err.status === 400 || err.status === 403)) {
        retryUntil?.set(c.key, now() + 10 * 60_000);
      }
      continue;
    }
    retryUntil?.delete(c.key);
    lastBad.set(c.key, c.bad);
    if (persist) await persist(c.key, c.bad);
  }
}

export interface AlertLoopOptions {
  botToken: string;
  chatId: string;
  intervalMs?: number;
  commitLagSec?: number;
  watcherStalledSec?: number;
  reportLagSec?: number;
}

export interface AlertLoopDeps {
  /** injectable for tests — defaults to the real Postgres-backed evaluateAlerts */
  evaluate?: typeof evaluateAlerts;
  /** injectable for tests — defaults to a real Telegram sendMessage call */
  send?: SendFn;
  /** injectable durable state; defaults to Postgres */
  state?: AlertStateStore;
  /** injectable process-local transport counters; defaults to budgeted RPC telemetry */
  readProviderStats?: () => RpcWireStats;
}

/** Every tick, evaluate checks and send only on a durable state transition. */
export async function runAlertLoop(
  signal: StopSignal,
  opts: AlertLoopOptions,
  deps: AlertLoopDeps = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 60_000;
  const evaluate = deps.evaluate ?? evaluateAlerts;
  const send = deps.send ?? makeTelegramSender(opts.botToken, opts.chatId, 15_000);
  const state = deps.state ?? prismaAlertStateStore(opts.chatId);
  const readProviderStats = deps.readProviderStats ?? rpcWireStats;
  const providerHealth = new ProviderHealthTracker();
  let lastBad: Map<AlertCheck['key'], boolean> | undefined;
  const unsaved = new Map<AlertCheck['key'], boolean>();
  const retryUntil = new Map<AlertCheck['key'], number>();
  let consecutiveLateReports = 0;
  let lastLateReportId: string | undefined;

  console.log(`[alerts] operational alert loop every ${intervalMs / 1000}s`);
  while (!signal.stopped) {
    try {
      // A failed load must not silently treat previously-alerted checks as new.
      lastBad ??= await state.load();
      // Retry a state write that failed after Telegram accepted its message.
      for (const [key, bad] of unsaved) {
        try {
          await state.save(key, bad);
          unsaved.delete(key);
        } catch (err) {
          console.error('[alerts] state retry failed', err instanceof Error ? err.message : err);
        }
      }
      const checks = await evaluate({
        commitLagSec: opts.commitLagSec,
        watcherStalledSec: opts.watcherStalledSec,
        reportLagSec: opts.reportLagSec,
      });
      const provider = providerHealth.sample(readProviderStats());
      if (provider) checks.push({ key: 'provider_failure', ...provider });
      const lag = checks.find((check) => check.key === 'report_lag');
      if (lag?.bad && lag.sampleId && lag.sampleId !== lastLateReportId) {
        consecutiveLateReports += 1;
        lastLateReportId = lag.sampleId;
      } else if (!lag?.bad) {
        consecutiveLateReports = 0;
        lastLateReportId = undefined;
      }
      // Require two distinct late reports so repeated scrapes of one outlier
      // cannot alert. A missing/stale sample cannot clear a delivered alert.
      const confirmed = checks.filter((check) => check.key !== 'report_lag' || !check.bad || consecutiveLateReports >= 2);
      await applyAlertTransitions(confirmed, lastBad, send, async (key, bad) => {
        unsaved.set(key, bad);
        try {
          await state.save(key, bad);
          unsaved.delete(key);
        } catch (err) {
          console.error('[alerts] state save failed', err instanceof Error ? err.message : err);
        }
      }, retryUntil);
    } catch (err) {
      console.error('[alerts] evaluate/state failed', err instanceof Error ? err.message : err);
    }
    // Stop within one second on SIGTERM, so a graceful deploy can persist a
    // successful send whose first state write failed.
    let remaining = intervalMs;
    while (!signal.stopped && remaining > 0) {
      const step = Math.min(remaining, 1_000);
      await new Promise((res) => setTimeout(res, step));
      remaining -= step;
    }
  }
  for (const [key, bad] of unsaved) {
    try {
      await state.save(key, bad);
    } catch (err) {
      console.error('[alerts] shutdown state save failed', err instanceof Error ? err.message : err);
    }
  }
}
