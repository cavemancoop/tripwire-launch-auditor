import { prisma } from '@launch-auditor/db';
import {
  ALL_OUTCOME_KEYS,
  goplusToProbabilities,
  scanhoodToProbabilities,
  type OutcomeKey,
  type ScoreRow,
} from '@launch-auditor/scoring';

/** OutcomeKey -> the Report probability column that holds that forecast. */
const P_COL: Partial<Record<OutcomeKey, string>> = {
  'INSIDER_EXIT@6h': 'pInsiderExit6h',
  'INSIDER_EXIT@24h': 'pInsiderExit24h',
  'INSIDER_EXIT@72h': 'pInsiderExit72h',
  'SELL_IMPAIRED@1h': 'pSellImpaired1h',
  'SELL_IMPAIRED@24h': 'pSellImpaired24h',
  'LIQ_IMPAIRED@24h': 'pLiqImpaired24h',
  'LIQ_IMPAIRED@7d': 'pLiqImpaired7d',
  'DRAWDOWN_80@24h': 'pDrawdown80_24h',
  'DRAWDOWN_80@7d': 'pDrawdown80_7d',
  'TRADING_ALIVE@24h': 'pTradingAlive24h',
  'TRADING_ALIVE@7d': 'pTradingAlive7d',
};

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
const obsKey = (chainId: number, token: string, anchor: Date): string =>
  `${chainId}|${token.toLowerCase()}|${anchor.toISOString()}`;

interface ResolvedObs {
  chainId: number;
  token: string;
  anchor: Date;
  trigger: string;
  launchId: string | null;
  labels: Map<OutcomeKey, boolean>;
}

export interface CollectOptions {
  /** include retrospective (backfill) rows, live rows, or both (default) */
  scope?: 'live' | 'retrospective' | 'both';
}

/**
 * Join resolved outcomes with every forecaster's prediction for the same
 * (token, anchor time). Emits ScoreRows for the report-backed forecasters
 * (det_v0, det_v0.1, heuristic_v1, …), plus computed rows for base_rate
 * (trailing-30-day prevalence) and the scanhood / goplus fixed maps.
 */
export async function collectScoreRows(opts: CollectOptions = {}): Promise<ScoreRow[]> {
  const scope = opts.scope ?? 'both';

  const outcomeWhere: Record<string, unknown> = { status: 'RESOLVED', value: { not: null } };
  if (scope === 'live') outcomeWhere['retrospective'] = false;
  if (scope === 'retrospective') outcomeWhere['retrospective'] = true;

  const outcomes = await prisma.outcome.findMany({ where: outcomeWhere });
  const obs = new Map<string, ResolvedObs>();
  for (const o of outcomes) {
    const k = obsKey(o.chainId, o.tokenAddress, o.anchorTime);
    let entry = obs.get(k);
    if (!entry) {
      entry = {
        chainId: o.chainId,
        token: o.tokenAddress.toLowerCase(),
        anchor: o.anchorTime,
        trigger: o.trigger,
        launchId: o.launchId,
        labels: new Map(),
      };
      obs.set(k, entry);
    }
    entry.labels.set(`${o.label}@${o.horizon}` as OutcomeKey, o.value === true);
  }
  if (obs.size === 0) return [];

  // trailing-30-day base rate per outcome key
  const perKey: Record<string, Array<{ t: number; y: boolean }>> = {};
  for (const e of obs.values()) {
    for (const [key, y] of e.labels) {
      (perKey[key] ??= []).push({ t: e.anchor.getTime(), y });
    }
  }
  for (const arr of Object.values(perKey)) arr.sort((a, b) => a.t - b.t);
  const trailingBaseRate = (key: OutcomeKey, at: number): number => {
    const arr = perKey[key] ?? [];
    let pos = 0;
    let tot = 0;
    for (const r of arr) {
      if (r.t >= at) break;
      if (r.t >= at - THIRTY_DAYS_MS) {
        tot++;
        if (r.y) pos++;
      }
    }
    if (tot === 0) {
      const all = arr.filter((r) => r.t < at);
      return all.length ? all.filter((r) => r.y).length / all.length : 0;
    }
    return pos / tot;
  };

  const rows: ScoreRow[] = [];

  // report-backed forecasters
  const reports = await prisma.report.findMany({
    where: { validatorPassed: true },
    include: { launch: { select: { source: true } } },
  });
  const launchAnchor = new Map<string, string>(); // launchId -> obsKey of its launch/qualified report
  for (const r of reports) {
    const k = obsKey(r.chainId, r.tokenAddress, r.reportTime);
    const e = obs.get(k);
    if (!e) continue;
    if (r.launchId && (r.trigger === 'launch' || r.trigger === 'qualified')) {
      launchAnchor.set(r.launchId, k);
    }
    const source = r.launch?.source ?? 'unknown';
    for (const key of ALL_OUTCOME_KEYS) {
      const y = e.labels.get(key);
      if (y === undefined) continue;
      const col = P_COL[key];
      if (!col) continue;
      const prob = (r as unknown as Record<string, number | null>)[col];
      if (prob === null || prob === undefined) continue;
      rows.push({ obsId: k, forecaster: r.forecaster, outcomeKey: key, trigger: r.trigger, source, prob, label: y });
    }
  }

  // base_rate_fixed — a constant climatology per outcome key (whole-sample
  // prevalence, same probability for every observation, no notion of time).
  // Codex Phase B #3: the rolling base_rate is a same-stream, time-varying
  // predictor whose live AUROC was ~0.37/0.42, not the ~0.5 a constant
  // predictor should score. This forecaster is the honest floor that claim
  // exists to explain against.
  const fixedBaseRate: Partial<Record<OutcomeKey, number>> = {};
  for (const [key, arr] of Object.entries(perKey)) {
    const positives = arr.filter((r) => r.y).length;
    fixedBaseRate[key as OutcomeKey] = positives / arr.length;
  }

  // base_rate / base_rate_fixed (one row per resolved obs/outcome)
  for (const e of obs.values()) {
    const source = await launchSource(e.launchId);
    for (const [key, y] of e.labels) {
      const k = obsKey(e.chainId, e.token, e.anchor);
      rows.push({
        obsId: k,
        forecaster: 'base_rate',
        outcomeKey: key,
        trigger: e.trigger,
        source,
        prob: round4(trailingBaseRate(key, e.anchor.getTime())),
        label: y,
      });
      rows.push({
        obsId: k,
        forecaster: 'base_rate_fixed',
        outcomeKey: key,
        trigger: e.trigger,
        source,
        prob: round4(fixedBaseRate[key] ?? 0),
        label: y,
      });
    }
  }

  // scanhood / goplus fixed maps
  const features = (
    await prisma.feature.findMany({
      include: { launch: { select: { id: true, source: true } } },
    })
  ).filter((f) => f.scanhoodRaw != null || f.goplusRaw != null);
  for (const f of features) {
    const k = launchAnchor.get(f.launch.id);
    if (!k) continue;
    const e = obs.get(k);
    if (!e) continue;
    const source = f.launch.source;
    const shProbs = scanhoodToProbabilities(f.scanhoodRaw as Record<string, unknown> | null);
    const gpProbs = goplusToProbabilities(f.goplusRaw as Record<string, unknown> | null);
    for (const [key, y] of e.labels) {
      if (shProbs[key] !== undefined) {
        rows.push({ obsId: k, forecaster: 'scanhood', outcomeKey: key, trigger: e.trigger, source, prob: shProbs[key]!, label: y });
      }
      if (gpProbs[key] !== undefined) {
        rows.push({ obsId: k, forecaster: 'goplus', outcomeKey: key, trigger: e.trigger, source, prob: gpProbs[key]!, label: y });
      }
    }
  }

  return rows;
}

const sourceCache = new Map<string, string>();
async function launchSource(launchId: string | null): Promise<string> {
  if (!launchId) return 'unknown';
  const hit = sourceCache.get(launchId);
  if (hit) return hit;
  const l = await prisma.launch.findUnique({ where: { id: launchId }, select: { source: true } });
  const s = l?.source ?? 'unknown';
  sourceCache.set(launchId, s);
  return s;
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
