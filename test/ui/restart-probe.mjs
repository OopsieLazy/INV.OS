// Counts how many times the layout RESTARTS after switching to a view.
//
// buildGraphData ends with gAlpha = 0.9, which re-heats the simulation from scratch.
// Calling it twice — once with no data, once when the data arrives — makes the view
// start, run for a moment, and visibly start over. One restart per switch is correct;
// two is the bug.
//
//   node restart-probe.mjs
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8221;
const BASE = `http://127.0.0.1:${PORT}`;
const N = Number(process.argv[2] || 3000);

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
  }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-restart-'));
execFileSync('go', ['build', '-o', 'invos-restart.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-restart.exe'),
  ['-db', join(dbDir, 'r.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

// enough items that the fetch takes a moment — that delay is what exposed the bug
const items = [];
for (let i = 0; i < N; i++) {
  items.push({ name: `Part ${i}`, bin: (i % 10) * 1000 + ((i / 10 | 0) % 10) * 100 + (i % 80) + 10, qty: 5, min: 1 });
}
for (let o = 0; o < items.length; o += 1000) {
  await fetch(`${BASE}/api/items/bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.slice(o, o + 1000), source: 'restart-probe' }),
  });
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

async function run(cmd) {
  await page.fill('#cmd', '');
  await page.type('#cmd', cmd, { delay: 2 });
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(400);
}
await run('__fr_go');

// Count buildGraphData calls directly. Watching gAlpha afterwards misses the bug
// entirely — over loopback the second build lands within milliseconds, before any
// polling loop gets going. A call count cannot be raced.
await page.evaluate(() => {
  window.__builds = 0;
  const orig = window.buildGraphData;
  window.buildGraphData = function () { window.__builds++; return orig.apply(this, arguments); };
});

async function countBuilds(cmd) {
  await page.evaluate(() => { window.__builds = 0; });
  await run(cmd);
  await page.waitForTimeout(1500);   // long enough for any late rebuild to land
  return page.evaluate(() => ({ builds: window.__builds, nodes: gNodes.length }));
}

console.log(`\nseeded ${N} items; counting layout builds per view switch`);
for (const cmd of ['graph inv', 'graph projects', 'graph inv']) {
  const r = await countBuilds(cmd);
  console.log(`  ${cmd.padEnd(16)} builds=${r.builds}  nodes=${r.nodes}   ${r.builds > 1 ? '<-- rebuilds, so the layout restarts' : ''}`);
}
console.log('  (1 build per switch is correct; 2 means it lays out, then lays out again)');

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
