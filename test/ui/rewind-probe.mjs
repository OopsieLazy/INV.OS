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
await run(process.env.PROBE_VIEW || 'graph galaxy');
if (MODE === 'orbit') await run('graph orbit');
if (process.env.PROBE_CMD) { await run(process.env.PROBE_CMD); await page.waitForTimeout(300); }

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
    // Parent-relative radius is the only honest measure of "did the orbits grow":
    // o.r is captured once and never written again, so an orbit can only look bigger
    // if the node has drifted off it or its parent has moved.
    const byId = {}; gNodes.forEach(n => byId[n.id] = n);
    let rSum = 0, tSum = 0, rN = 0, worst = 0;
    for (const n of gNodes) {
      const o = n.orb; if (!o) continue;
      const par = byId[o.parent]; if (!par) continue;
      const d = Math.hypot(n.x - par.x, n.y - par.y, (n.z || 0) - (par.z || 0));
      rSum += d; tSum += o.r; rN++;
      const err = Math.abs(d - o.r) / (o.r || 1);
      if (err > worst) worst = err;
    }
    frames.push({
      pos: gNodes.map(n => [n.x, n.y, n.z || 0]),
      ids: gNodes.map(n => n.id).join('|'),
      alpha: gAlpha,
      orbN: rN, orbActual: rN ? rSum / rN : 0, orbTarget: rN ? tSum / rN : 0, orbWorst: worst,
    });
    await new Promise(r => requestAnimationFrame(r));
  }
  window.buildGraphData = origBuild;
  if (origInit) window.initOrbits = origInit;
  return { frames, events };
});

const { frames, events } = trace;

const direct = await page.evaluate(() => {
  const byId = {}; gNodes.forEach(n => byId[n.id] = n);
  return gNodes.filter(n => n.orb).slice(0, 4).map(n => {
    const p = byId[n.orb.parent];
    return { id: n.id, parent: n.orb.parent, haveParent: !!p, r: +n.orb.r.toFixed(1),
      dist: p ? +Math.hypot(n.x-p.x, n.y-p.y, (n.z||0)-(p.z||0)).toFixed(1) : null,
      ramp: +gOrbitRamp.toFixed(3) };
  });
});
console.log('direct read after the trace:');
for (const d of direct) console.log('  ', JSON.stringify(d));

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
  for (let f = Math.max(1, initFrame - 3); f < Math.min(steps.length, initFrame + 130); f += 6) {
    around.push(`f${f}:${steps[f - 1] === null ? '-' : steps[f - 1].toFixed(2)}`);
  }
  console.log('\nspeed around the orbit handoff:');
  console.log('  ' + around.join(' '));
  const before = steps[initFrame - 2] ?? 0;
  const justAfter = steps[initFrame] ?? 0;
  console.log(`  before ${before.toFixed(2)} -> just after ${justAfter.toFixed(2)}` +
    (justAfter > Math.max(0.5, before * 4) ? '   <-- velocity jump (a burst)' : '   (eased)'));
}

// 1c. does the LAYOUT change across the handoff? The orbits should take over the
// positions the force layout produced, not keep expanding them.
if (initFrame) {
  const radius = (f) => {
    const p = frames[f].pos;
    let s = 0;
    for (const q of p) s += Math.hypot(q[0], q[1], q[2]);
    return s / p.length;
  };
  const before = radius(Math.max(0, initFrame - 2));
  const mid = radius(Math.min(frames.length - 1, initFrame + 45));
  const after = radius(frames.length - 1);
  console.log(`
mean radius: before ${before.toFixed(0)} · mid-handoff ${mid.toFixed(0)} · settled ${after.toFixed(0)}`);
  // NOTE: this is distance from the ORIGIN, and it is NOT a measure of orbit size. A
  // settled cluster sits on one side of its parent; once the orbits run, the nodes
  // spread around the whole circle, so this number climbs by 1.3-1.7x in every build,
  // including ones where the orbits are provably identical. Read the parent-relative
  // radius below instead — that is the one that answers "did the orbits change".
  const grew = after / (before || 1);
  console.log(`  spread from origin across the handoff: ${grew.toFixed(2)}x   (phase, not size)`);

  const orb = (f) => frames[f];
  const show = (label, f) => {
    const x = orb(f);
    if (!x.orbN) { console.log(`  ${label}: no orbits yet`); return; }
    console.log(`  ${label.padEnd(14)} nodes ${String(x.orbN).padStart(4)}` +
      `  mean |node-parent| ${x.orbActual.toFixed(1).padStart(7)}` +
      `  captured o.r ${x.orbTarget.toFixed(1).padStart(7)}` +
      `  worst drift ${(x.orbWorst * 100).toFixed(1)}%`);
  };
  console.log('\norbit radius (the actual "are the orbits bigger" question):');
  show('at capture', Math.min(frames.length - 1, initFrame + 1));
  show('mid-handoff', Math.min(frames.length - 1, initFrame + 45));
  show('settled', frames.length - 1);
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
