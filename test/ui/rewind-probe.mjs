// Records every node position, every frame, after switching to a view — then looks for
// the moment the layout jumps BACKWARD to somewhere it already was.
//
// Reported as: it runs, then resets to a position from a moment ago, then carries on.
// That is a rewind, not a re-layout, so this looks for two things a re-layout would not
// cause: a frame where displacement spikes, and a frame whose positions match an EARLIER
// recorded frame better than the one just before it.
//
//   node rewind-probe.mjs [orbit|force]
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8222;
const BASE = `http://127.0.0.1:${PORT}`;
const MODE = process.argv[2] || 'orbit';

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
  }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-rewind-'));
execFileSync('go', ['build', '-o', 'invos-rewind.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-rewind.exe'),
  ['-db', join(dbDir, 'w.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
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

await run('__fr_demo');
await run('graph galaxy');
if (MODE === 'orbit') await run('graph orbit');

// Record from the moment of the switch, so the early frames are captured.
const trace = await page.evaluate(async () => {
  const frames = [];
  const events = [];

  // note when the layout is rebuilt or the orbits are (re)captured
  const origBuild = window.buildGraphData;
  window.buildGraphData = function () { events.push([frames.length, 'buildGraphData']); return origBuild.apply(this, arguments); };
  const origInit = window.initOrbits;
  if (origInit) window.initOrbits = function () { events.push([frames.length, 'initOrbits']); return origInit.apply(this, arguments); };

  for (let f = 0; f < 300; f++) {
    frames.push({
      pos: gNodes.map(n => [n.x, n.y, n.z || 0]),
      ids: gNodes.map(n => n.id).join('|'),
      alpha: gAlpha,
    });
    await new Promise(r => requestAnimationFrame(r));
  }
  window.buildGraphData = origBuild;
  if (origInit) window.initOrbits = origInit;
  return { frames, events };
});

const { frames, events } = trace;

// distance between two frames, only when the node set is identical
const dist = (a, b) => {
  if (a.ids !== b.ids) return null;
  let s = 0;
  for (let i = 0; i < a.pos.length; i++) {
    s += Math.hypot(a.pos[i][0] - b.pos[i][0], a.pos[i][1] - b.pos[i][1], a.pos[i][2] - b.pos[i][2]);
  }
  return s / a.pos.length;
};

console.log(`\nmode=${MODE}, ${frames[0].pos.length} nodes, ${frames.length} frames recorded`);
console.log('events:', events.map(e => `${e[1]}@f${e[0]}`).join(', ') || 'none');

// 1. per-frame movement — a spike is a discontinuity
const steps = [];
for (let f = 1; f < frames.length; f++) steps.push(dist(frames[f - 1], frames[f]));
const valid = steps.filter(v => v !== null);
const sorted = [...valid].sort((a, b) => a - b);
const median = sorted[sorted.length >> 1] || 0;
console.log(`\nper-frame movement: median ${median.toFixed(2)}`);
const spikes = steps.map((v, i) => [i + 1, v]).filter(([, v]) => v !== null && v > Math.max(1, median * 8));
console.log('spikes (frame, movement):', spikes.length ? spikes.slice(0, 8).map(([f, v]) => `f${f}=${v.toFixed(1)}`).join(', ') : 'none');

// 1b. the speed PROFILE around the handoff — position can be continuous while the
// velocity jumps, which reads as "drifts, then suddenly bursts into orbit"
const initFrame = (events.find(e => e[1] === 'initOrbits') || [])[0];
if (initFrame) {
  const around = [];
  for (let f = Math.max(1, initFrame - 3); f < Math.min(steps.length, initFrame + 24); f++) {
    around.push(`f${f}:${steps[f - 1] === null ? '-' : steps[f - 1].toFixed(2)}`);
  }
  console.log('\nspeed around the orbit handoff:');
  console.log('  ' + around.join(' '));
  const before = steps[initFrame - 2] ?? 0;
  const justAfter = steps[initFrame] ?? 0;
  console.log(`  before ${before.toFixed(2)} -> just after ${justAfter.toFixed(2)}` +
    (justAfter > Math.max(0.5, before * 4) ? '   <-- velocity jump (a burst)' : '   (eased)'));
}

// 2. rewinds — a frame closer to an OLDER frame than to its predecessor
const rewinds = [];
for (let f = 6; f < frames.length; f++) {
  const toPrev = dist(frames[f - 1], frames[f]);
  if (toPrev === null || toPrev < median * 4) continue;
  let best = null;
  for (let k = 2; k < Math.min(f, 90); k++) {
    const d = dist(frames[f - k], frames[f]);
    if (d !== null && (best === null || d < best[1])) best = [k, d];
  }
  if (best && best[1] < toPrev * 0.5) rewinds.push([f, best[0], best[1], toPrev]);
}
console.log('rewinds:', rewinds.length
  ? rewinds.slice(0, 6).map(([f, k, d, p]) => `f${f} matches f${f - k} (d=${d.toFixed(1)} vs prev ${p.toFixed(1)})`).join('; ')
  : 'none');

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
