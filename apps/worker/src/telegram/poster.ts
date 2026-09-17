/**
 * M8 — free feed: post each qualified launch's det_v0 summary + proof link to
 * a Telegram channel once its report has a commit (so the proof link
 * resolves). `telegramPostedAt` on the report row is the dedupe guard: a
 * restart never re-posts a report it already sent.
 */
import { getChainConfig } from '@launch-auditor/chain';
import { prisma } from '@launch-auditor/db';
import { recordFailure } from '../failures';
import type { StopSignal } from '../watcher/poller';

export interface TelegramCandidateRow {
  id: string;
  tokenAddress: string;
  reportHash: string;
  pInsiderExit24h: number | null;
  pDrawdown80_24h: number | null;
  pTradingAlive24h: number | null;
  txHash: string | null;
}

export type CandidateReader = (limit: number) => Promise<TelegramCandidateRow[]>;
export type MarkPosted = (reportId: string) => Promise<void>;
export type TelegramSender = (text: string) => Promise<void>;

/** Qualified-lane, committed, not-yet-posted det_v0 reports, oldest first. */
const prismaCandidateReader: CandidateReader = async (limit) => {
  const reports = await prisma.report.findMany({
    where: {
      forecaster: 'det_v0',
      retrospective: false,
      telegramPostedAt: null,
      commitId: { not: null },
      launch: { lane: 'qualified', retrospective: false },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { commit: { select: { txHash: true } } },
  });
  return reports.map((r) => ({
    id: r.id,
    tokenAddress: r.tokenAddress,
    reportHash: r.reportHash,
    pInsiderExit24h: r.pInsiderExit24h,
    pDrawdown80_24h: r.pDrawdown80_24h,
    pTradingAlive24h: r.pTradingAlive24h,
    txHash: r.commit?.txHash ?? null,
  }));
};

const prismaMarkPosted: MarkPosted = async (id) => {
  await prisma.report.update({ where: { id }, data: { telegramPostedAt: new Date() } });
};

const pct = (v: number | null): string => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);

/**
 * Commits are Merkle-batched (spec §6): one root per batch of report hashes
 * every 5 minutes, so every launch in a batch shares one transaction. Correct,
 * but linking only the tx made consecutive posts all point at the same hash —
 * which reads like a bug to anyone who doesn't know the design. Lead with the
 * per-report verify link, which proves *this* forecast against that root, and
 * label the tx as the batch anchor it is.
 */
export function formatTelegramMessage(
  row: TelegramCandidateRow,
  chainId: number,
  apiBase?: string,
): string {
  const explorer = getChainConfig(chainId).explorer;
  const lines = [
    `New qualified launch: ${row.tokenAddress}`,
    `P(insider exit, 24h): ${pct(row.pInsiderExit24h)}`,
    `P(drawdown ≥80%, 24h): ${pct(row.pDrawdown80_24h)}`,
    `P(still trading, 24h): ${pct(row.pTradingAlive24h)}`,
  ];
  if (apiBase) {
    lines.push(`Verify this forecast: ${apiBase.replace(/\/$/, '')}/v1/proof/${row.reportHash}`);
  }
  lines.push(
    row.txHash
      ? `Batch anchor (many reports, one Merkle root): ${explorer}/tx/${row.txHash}`
      : 'Proof: pending next commit batch',
  );
  lines.push(`Report hash: ${row.reportHash}`);
  lines.push('committed before outcome · reproducible scorer');
  return lines.join('\n');
}

export function makeTelegramSender(botToken: string, chatId: string): TelegramSender {
  return async (text) => {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`telegram sendMessage ${res.status}: ${body.slice(0, 200)}`);
    }
  };
}

export interface PosterDeps {
  chainId: number;
  /** public API base, so each post can link its own verifiable proof */
  apiBase?: string;
  send: TelegramSender;
  readCandidates?: CandidateReader;
  markPosted?: MarkPosted;
  limit?: number;
}

export interface PosterSweepResult {
  candidates: number;
  posted: number;
  failed: number;
}

/**
 * One sweep: post every unposted qualified-launch report, oldest first. A
 * send failure is logged and left unmarked so the next sweep retries it — it
 * never counts as posted and never blocks the rest of the batch.
 */
export async function postQualifiedLaunches(deps: PosterDeps): Promise<PosterSweepResult> {
  const readCandidates = deps.readCandidates ?? prismaCandidateReader;
  const markPosted = deps.markPosted ?? prismaMarkPosted;
  const limit = deps.limit ?? 5;

  const rows = await readCandidates(limit);
  let posted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await deps.send(formatTelegramMessage(row, deps.chainId, deps.apiBase));
      await markPosted(row.id);
      posted += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`[telegram] post failed for ${row.tokenAddress}:`, err instanceof Error ? err.message : err);
      await recordFailure('telegram.post_failed', err);
    }
  }
  return { candidates: rows.length, posted, failed };
}

export interface TelegramPosterLoopOptions {
  botToken: string;
  chatId: string;
  chainId: number;
  apiBase?: string;
  intervalMs?: number;
  limit?: number;
}

export async function runTelegramPosterLoop(
  signal: StopSignal,
  opts: TelegramPosterLoopOptions,
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 30_000;
  const send = makeTelegramSender(opts.botToken, opts.chatId);
  // eslint-disable-next-line no-console
  console.log(`[telegram] free-feed poster every ${intervalMs / 1000}s -> chat ${opts.chatId}`);
  while (!signal.stopped) {
    try {
      const r = await postQualifiedLaunches({ chainId: opts.chainId, send, limit: opts.limit, apiBase: opts.apiBase });
      if (r.candidates > 0) {
        // eslint-disable-next-line no-console
        console.log(`[telegram] swept ${r.candidates}: ${r.posted} posted · ${r.failed} failed`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[telegram] sweep error', err instanceof Error ? err.message : err);
      await recordFailure('telegram.sweep_error', err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
