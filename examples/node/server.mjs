// Minimal jsLogger receiver with zero dependencies (Node 18+).
//
//   npm run demo            # builds, then serves the demo on http://localhost:3000
//   PORT=4000 node examples/node/server.mjs
//
// POST /logs   receives { events: [...] }, prints one line per event and appends
//              them to examples/node/logs.jsonl (one JSON object per line).
// GET  /logs   the last 50 events (used by the demo page).
// GET  /       the demo page; /jsLogger.js is the <script> build from dist/.

import { appendFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(here, 'logs.jsonl');
const PORT = Number(process.env.PORT ?? 3000);
const recent = [];

const COLORS = { trace: 90, debug: 36, info: 32, warn: 33, error: 31, fatal: 35 };
const paint = (level, text) => (process.stdout.isTTY ? `\x1b[${COLORS[level] ?? 0}m${text}\x1b[0m` : text);

function cors(res) {
  // Allow any origin for the demo. In production, list your sites instead of '*'.
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-api-key');
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  cors(res);
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    if (pathname === '/logs' && req.method === 'POST') {
      // sendBeacon posts as text/plain, so parse the body whatever the content type says.
      const { events } = JSON.parse(await body(req));
      if (!Array.isArray(events)) return res.writeHead(400).end('expected { events: [] }');
      for (const event of events) {
        const received = { receivedAt: new Date().toISOString(), ...event };
        recent.unshift(received);
        console.log(`${paint(event.level, event.level.toUpperCase().padEnd(5))} ${event.source.padEnd(18)} ${event.message}`);
      }
      recent.length = Math.min(recent.length, 50);
      await appendFile(LOG_FILE, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      return res.writeHead(204).end();
    }

    if (pathname === '/logs' && req.method === 'GET') {
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(recent));
    }

    if (pathname === '/') {
      const html = await readFile(join(here, '../browser/index.html'));
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    }

    if (pathname === '/jsLogger.js') {
      const js = await readFile(join(here, '../../dist/jsLogger.global.js'));
      return res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
    }

    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not Found');
  } catch (error) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end(String(error.message ?? error));
  }
});

server.listen(PORT, () => console.log(`jsLogger demo on http://localhost:${PORT}  (logs -> ${LOG_FILE})`));
