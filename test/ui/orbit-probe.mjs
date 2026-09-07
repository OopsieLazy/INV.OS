// Counts nodes that project BEHIND the camera in the galaxy view.
//
// A node whose rotated depth falls past the camera plane gets a negative perspective
// divide, which mirrors it to the opposite side of the screen at negative size. On
// screen that reads as clusters randomly flipping across the view as they swing close.
//
//   node orbit-probe.mjs
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8220;
const BASE = `http://127.0.0.1:${PORT}`;

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
  }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-orbit-'));
execFileSync('go', ['build', '-o', 'invos-orbit.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-orbit.exe'),
  ['-db', join(dbDir, 'o.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

async function run(cmd) {
  await page.fill('#cmd', '');
  await page.type('#cmd', cmd, { delay: 2 });
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(600);
}

await run('__fr_demo');       // demo has the projects the galaxy needs
await run('graph galaxy');
await run('graph 3d');
await run('graph orbit');
await page.waitForFunction(() => typeof gOrbitInit !== 'undefined' && gOrbitInit,
  null, { timeout: 10000 }).catch(() => console.log('  (orbits never initialised)'));

// Sample across a full camera rotation, because whether a node is behind the camera
// depends on the yaw — the flip appears as the view turns.
const worst = await page.evaluate(async () => {
  let behind = 0, flipped = 0, frames = 0, maxBehind = 0;
  for (let i = 0; i < 60; i++) {
    gYaw += Math.PI * 2 / 60;
    const { W, H } = gDims();
    let b = 0;
    for (const n of gNodes) {
      const p = project(n, W, H);
      const denom = gCamZ + (p.depth) + 300;
      if (denom <= 1) { b++; if (p.scale < 0) flipped++; }
    }
    behind += b; maxBehind = Math.max(maxBehind, b); frames++;
    await new Promise(r => requestAnimationFrame(r));
  }

  // Smoothness: how far a node's SCREEN position moves between consecutive frames with
  // the camera held still. Orbits should glide; a big jump is the jank.
  const { W, H } = gDims();
  const prev = new Map();
  let maxJump = 0, p95 = [];
  for (let f = 0; f < 90; f++) {
    for (const n of gNodes) {
      const p = project(n, W, H);
      if (!p.vis) { prev.delete(n); continue; }
      const was = prev.get(n);
      if (was) {
        const d = Math.hypot(p.sx - was[0], p.sy - was[1]);
        if (f > 2) { p95.push(d); if (d > maxJump) maxJump = d; }
      }
      prev.set(n, [p.sx, p.sy]);
    }
    await new Promise(r => requestAnimationFrame(r));
  }
  p95.sort((a, b) => a - b);
  return {
    nodes: gNodes.length, avgBehind: +(behind / frames).toFixed(1), maxBehind, flipped,
    jumpP95: +(p95[Math.floor(p95.length * 0.95)] || 0).toFixed(1),
    jumpMax: +maxJump.toFixed(1),
  };
});

console.log('\ngalaxy view, camera swept through a full turn:');
console.log('  nodes                    ', worst.nodes);
console.log('  avg nodes behind camera  ', worst.avgBehind);
console.log('  worst frame              ', worst.maxBehind);
console.log('  drawn at NEGATIVE size   ', worst.flipped, '(each one is a visible flip)');
console.log('  per-frame screen movement: p95', worst.jumpP95 + 'px, worst', worst.jumpMax + 'px');
console.log('  (smooth orbit = a few px a frame; a big worst-case is a visible snap)');

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
