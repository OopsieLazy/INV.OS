// Records frame-to-frame intervals while the graph starts, and reports the stutters.
//
// "Sometimes laggy" needs measuring across repeated runs, not reasoning about: a
// stutter that happens one open in three is invisible to a single sample.
//
//   node frame-probe.mjs [runs] [items]
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8224;
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = Number(process.argv[2] || 5);
const ITEMS = Number(process.argv[3] || 400);

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
  }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-frame-'));
execFileSync('go', ['build', '-o', 'invos-frame.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-frame.exe'),
  ['-db', join(dbDir, 'f.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

const items = [];
for (let i = 0; i < ITEMS; i++) {
  items.push({ name: `Part ${i}`, bin: (i % 10) * 1000 + ((i / 10 | 0) % 10) * 100 + (i % 80) + 10, qty: 5, min: 1 });
}
for (let o = 0; o < items.length; o += 1000) {
  await fetch(`${BASE}/api/items/bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.slice(o, o + 1000), source: 'frame-probe' }),
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
  await page.waitForTimeout(300);
}
await run('__fr_go');

console.log(`\n${ITEMS} items · ${RUNS} runs · frame intervals while the graph starts`);
console.log('  run   frames   p50     p95     worst   stutters(>32ms)  physics/draw of worst');
console.log('  ──────────────────────────────────────────────────────────────────────────────');

for (let r = 0; r < RUNS; r++) {
  await run('graph off');
  await page.waitForTimeout(300);

  const res = await page.evaluate(async () => {
    // Time the two halves inside gTick so a slow frame can be attributed.
    window.__f = [];
    const origPhys = window.gPhysics, origDraw = window.gDraw;
    let lastPhys = 0, lastDraw = 0;
    window.gPhysics = function (a) { const t = performance.now(); const r = origPhys.call(this, a); lastPhys = performance.now() - t; return r; };
    window.gDraw = function () { const t = performance.now(); const r = origDraw.apply(this, arguments); lastDraw = performance.now() - t; return r; };

    let prev = performance.now();
    const stop = performance.now() + 3000;
    // open the graph the way a person does
    await exec('graph inv');
    while (performance.now() < stop) {
      await new Promise(rr => requestAnimationFrame(rr));
      const now = performance.now();
      window.__f.push([now - prev, lastPhys, lastDraw]);
      prev = now;
    }
    window.gPhysics = origPhys; window.gDraw = origDraw;

    const d = window.__f.map(x => x[0]).sort((a, b) => a - b);
    const worst = window.__f.reduce((m, x) => x[0] > m[0] ? x : m, [0, 0, 0]);
    return {
      frames: d.length,
      p50: d[d.length >> 1] || 0,
      p95: d[Math.floor(d.length * 0.95)] || 0,
      worst: worst[0], worstPhys: worst[1], worstDraw: worst[2],
      stutters: d.filter(v => v > 32).length,
      nodes: gNodes.length,
      first: window.__f.slice(0, 6).map(x => x.map(v => +v.toFixed(1))),
    };
  });

  console.log(`  ${String(r + 1).padStart(3)}   ${String(res.frames).padStart(6)}  ` +
    `${res.p50.toFixed(1).padStart(6)}  ${res.p95.toFixed(1).padStart(6)}  ${res.worst.toFixed(1).padStart(6)}  ` +
    `${String(res.stutters).padStart(15)}   ${res.worstPhys.toFixed(1)}ms / ${res.worstDraw.toFixed(1)}ms`);
  if (r === 0) console.log('        first frames [interval, physics, draw]:', JSON.stringify(res.first));
}

console.log('\n  (a 60fps frame is 16.7ms; anything over ~32ms is a dropped frame you can see)');

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
