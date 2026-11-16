// Regenerates the README pictures: starts the demo server (examples/node), clicks
// through the demo page in headless Edge (or Chrome), and captures the page plus
// the server's console output.
//
//   npm run screenshots                      # builds first
//   BROWSER_CHANNEL=chrome npm run screenshots

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => join(root, 'docs', `${name}.png`);
const PORT = 3917;

rmSync(join(root, 'examples/node/logs.jsonl'), { force: true });
const server = spawn(process.execPath, [join(root, 'examples/node/server.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
});
let serverOutput = '';
server.stdout.on('data', (d) => (serverOutput += d));
server.stderr.on('data', (d) => process.stderr.write(d));
await new Promise((resolve) => server.stdout.once('data', resolve));

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1040, height: 560 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await page.goto(`http://localhost:${PORT}/`);

  for (const id of ['info', 'throw', 'reject', 'fetch404', 'img', 'secret']) {
    await page.click(`#${id}`);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => document.querySelectorAll('#events li[data-id]').length >= 6, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('demo') });
  console.log('docs/demo.png');

  // One event opened: the full JSON the endpoint receives.
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.locator('#events li', { hasText: 'Payment provider timed out' }).click();
  await page.waitForSelector('#events pre');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('event') });
  console.log('docs/event.png');

  // The receiver's terminal, rendered from its real stdout.
  const lines = serverOutput.trim().split('\n').slice(1);
  const colors = { INFO: '#3fb950', WARN: '#d29922', ERROR: '#f85149' };
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const html = lines
    .map((l) => {
      const level = l.slice(0, 5).trim();
      return `<div><span style="color:${colors[level] ?? '#c9d1d9'};font-weight:700">${esc(l.slice(0, 5))}</span>${esc(l.slice(5))}</div>`;
    })
    .join('');
  const term = await browser.newPage({ viewport: { width: 1040, height: 60 + lines.length * 21 + 40 }, deviceScaleFactor: 2 });
  await term.setContent(`<body style="margin:0;background:#0d1117;color:#c9d1d9;font:13px/21px Consolas,ui-monospace,monospace;padding:16px 20px;white-space:pre">
<div style="color:#8b949e">$ node examples/node/server.mjs</div><div style="color:#8b949e">jsLogger demo on http://localhost:${PORT}  (logs -&gt; examples/node/logs.jsonl)</div>${html}</body>`);
  await term.screenshot({ path: out('server') });
  console.log('docs/server.png');
} finally {
  await browser.close();
  server.kill();
}
