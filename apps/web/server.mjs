#!/usr/bin/env node
/**
 * M8 — the dashboard is plain HTML/CSS/JS with no build step, so serving it
 * needs no framework either: node's own http + fs cover a handful of static
 * files. All real data comes from the api at request time via client-side
 * fetch() (see public/app.js) — this process never touches Postgres/Redis.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.WEB_PORT || 3002);
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  if (rel.startsWith('..')) rel = '/index.html'; // no path traversal out of public/

  let filePath = join(PUBLIC_DIR, rel);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(PUBLIC_DIR, 'index.html'); // single-page app: unknown paths fall back
  }

  res.setHeader('Content-Type', TYPES[extname(filePath)] || 'application/octet-stream');
  createReadStream(filePath)
    .on('error', () => {
      res.statusCode = 404;
      res.end('not found');
    })
    .pipe(res);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`launch-auditor-web listening on http://${HOST}:${PORT}`);
});
