// Measures the graph's ceiling: how many nodes can it simulate and draw per frame,
// and which half is the bottleneck.
//
// Physics and rendering are timed SEPARATELY, because they have completely different
// fixes — one is an algorithm problem, the other is a draw-call problem — and guessing
// which one is hurting is how people optimize the wrong half.
//
//   node graph-bench.mjs
//   node graph-bench.mjs 500 2000 10000
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8218;
const BASE = `http://127.0.0.1:${PORT}`;
const SIZES = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const NODE_COUNTS = SIZES.length ? SIZES : [500, 1500, 5000, 15000];

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
  }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-bench-'));
execFileSync('go', ['build', '-o', 'invos-bench.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-bench.exe'),
  ['-db', join(dbDir, 'b.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

// open the graph so the canvas is sized and the loop is live
await page.fill('#cmd', ''); await page.type('#cmd', 'graph inv'); await page.press('#cmd', 'Enter');
await page.waitForTimeout(800);

console.log('\n  nodes   physics/frame   draw/frame   total   est. fps   heap');
console.log('  ─────────────────────────────────────────────────────────────────');

for (const n of NODE_COUNTS) {
  const r = await page.evaluate(async (N) => {
    // Build a synthetic graph of N parts spread over the ten departments, shaped like
    // a real one: a sun, dept hubs, section hubs, and parts hanging off them.
    const nodes = [], edges = [], byId = {};
    const addN = (id, type, label, extra = {}) => {
      const nd = { id, type, label, ...extra,
        x: (Math.random() - 0.5) * 2000, y: (Math.random() - 0.5) * 2000,
        z: (Math.random() - 0.5) * 2000, vx: 0, vy: 0, vz: 0 };
      byId[id] = nd; nodes.push(nd); return nd;
    };
    const addE = (a, b, w = 1) => edges.push({ a: byId[a], b: byId[b], w });

    const sun = addN('SUN', 'sun', 'SECTIONS', { count: N });
    sun.x = sun.y = sun.z = 0;
    for (let d = 0; d < 10; d++) {
      addN('d' + d, 'dept', 'DEPT' + d, { count: N / 10 });
      addE('d' + d, 'SUN');
      for (let s = 0; s < 10; s++) { addN('s' + d + s, 'sec', 'SEC' + d + s, { count: N / 100 }); addE('s' + d + s, 'd' + d); }
    }
    for (let i = 0; i < N; i++) {
      const d = i % 10, s = (i / 10 | 0) % 10;
      addN('c' + i, 'part', 'Part ' + i, { low: i % 17 === 0 });
      addE('c' + i, 's' + d + s);
    }

    gNodes = nodes; gEdges = edges;
    gAlpha = 0.6;                 // a live, still-settling simulation: the worst case
    await new Promise(r => requestAnimationFrame(r));

    // Time the two halves separately over a run of frames.
    const FRAMES = 30;
    let physics = 0, draw = 0;
    for (let f = 0; f < FRAMES; f++) {
      const t0 = performance.now();
      gAlpha = 0.6;               // hold it hot so physics runs every frame
      gPhysics(0.6);
      const t1 = performance.now();
      gDraw();
      const t2 = performance.now();
      physics += t1 - t0; draw += t2 - t1;
      await new Promise(r => requestAnimationFrame(r));
    }
    const heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0;
    return { physics: physics / FRAMES, draw: draw / FRAMES, heap, nodes: gNodes.length };
  }, n);

  const total = r.physics + r.draw;
  console.log(`  ${String(n).padStart(6)}   ${r.physics.toFixed(1).padStart(9)} ms   ${r.draw.toFixed(1).padStart(7)} ms  ${total.toFixed(1).padStart(6)} ms  ${(total > 0 ? (1000 / total).toFixed(0) : '—').padStart(8)}   ${r.heap.toFixed(0)} MB`);
}

console.log('\n  (60 fps needs the total under 16.7 ms)');

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
