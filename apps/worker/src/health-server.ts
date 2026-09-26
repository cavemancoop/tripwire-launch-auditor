/**
 * M9 — a liveness endpoint for the worker process. The loops themselves
 * (watcher, commit, metabolism, deep-dive, scorer, telegram, alerts) need no
 * public port to do their job; this exists only so Railway (or a human) has
 * something to probe, dependency-free like apps/web/server.mjs.
 */
import { createServer, type Server } from 'node:http';
import { formatLoopMetrics, loopMetrics } from './loop-metrics';
import { formatWorkerMetrics, observe } from './observability';

/** Package 2a/2b: process and loop observation. */
export const defaultWorkerMetrics = (): string =>
  formatWorkerMetrics(observe()) + formatLoopMetrics(loopMetrics.snapshot());

/** Package 2a: `/metrics` is observation only and private-network only (the
 *  worker has no public domain); `/health` stays a constant liveness answer. */
export function startHealthServer(port: number, metrics: () => string = defaultWorkerMetrics): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, service: 'launch-auditor-worker' }));
      return;
    }
    if (req.url === '/metrics') {
      let body: string;
      try {
        body = metrics();
      } catch {
        // contained: a fixed body, never the exception text (it could carry an RPC URL or key)
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('metrics unavailable\n');
        return;
      }
      res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(body);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[health] worker health server listening on :${port}`);
  });
  return server;
}
