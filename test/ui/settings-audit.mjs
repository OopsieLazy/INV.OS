// Audits every setting: does changing it take effect immediately, and does it survive
// a reload? A setting that stores a value but changes nothing until you restart is
// worse than no setting — it looks like it worked.
//
//   node settings-audit.mjs
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8223;
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

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  ok ? passed++ : failures.push(name);
};

const dbDir = mkdtempSync(join(tmpdir(), 'invos-set-'));
execFileSync('go', ['build', '-o', 'invos-set.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-set.exe'),
  ['-db', join(dbDir, 's.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

async function run(cmd) {
  await page.fill('#cmd', '');
  await page.type('#cmd', cmd, { delay: 2 });
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(350);
}
const get = (fn, arg) => page.evaluate(fn, arg);

await run('__fr_demo');
await page.waitForTimeout(600);

// ── every numeric setting stores what the stepper set ──────────────────────
console.log('\nstepping each setting');
const keys = await get(() => SETTINGS.map(s => s.k));
for (const k of keys) {
  const before = await get((kk) => cfg(kk), k);
  await run(`cfgadj ${k} up`);
  const after = await get((kk) => cfg(kk), k);
  const m = await get((kk) => SETTINGS.find(s => s.k === kk), k);
  const expected = Math.min(m.max, before + m.step);
  check(`${k}: the stepper changes the stored value`,
    Math.abs(after - expected) < 1e-6 || (before >= m.max && after === before),
    `${before} -> ${after}, expected ${expected}`);
}

// ── settings that must take effect WITHOUT a reload ─────────────────────────
console.log('\nlive effect');

await run('graph galaxy');
await page.waitForTimeout(400);

// orbit motion: the setting and the running mode must agree
await run('cfgadj orbit up');            // 0 -> 1
const orbitLive = await get(() => ({ cfg: cfg('orbit'), gOrbit }));
check('orbit motion: turning it ON in settings starts it',
  orbitLive.cfg === 1 && orbitLive.gOrbit === true, JSON.stringify(orbitLive));

await run('cfgadj orbit down');           // 1 -> 0
const orbitOff = await get(() => ({ cfg: cfg('orbit'), gOrbit }));
check('orbit motion: turning it OFF in settings stops it',
  orbitOff.cfg === 0 && orbitOff.gOrbit === false, JSON.stringify(orbitOff));

// the command and the setting are the same switch
await run('graph orbit');
const viaCmd = await get(() => ({ cfg: cfg('orbit'), gOrbit }));
check('the graph orbit command and the setting stay in step',
  viaCmd.cfg === (viaCmd.gOrbit ? 1 : 0), JSON.stringify(viaCmd));
await run('graph orbit');

// galaxy: switching it off while looking AT the galaxy must leave the view
await run('graph galaxy');
const inGalaxy = await get(() => gView.kind);
await run('cfgadj galaxy down');          // 1 -> 0
const afterOff = await get(() => ({ cfg: cfg('galaxy'), view: gView.kind }));
check('galaxy: switching it off leaves the galaxy view',
  inGalaxy === 'galaxy' && afterOff.cfg === 0 && afterOff.view !== 'galaxy',
  `was ${inGalaxy}, now ${JSON.stringify(afterOff)}`);
await run('cfgadj galaxy up');

// launch zoom applies to the CURRENT view, not just the next one to open
await run('graph inv');
await page.waitForTimeout(400);
const zoomBefore = await get(() => gScale);
await run('cfgadj launchZoom up');
const zoomAfter = await get(() => gScale);
check('launch zoom: changing it moves the current view',
  Math.abs(zoomAfter - zoomBefore) > 1e-6, `${zoomBefore} -> ${zoomAfter}`);

// ── reset ──────────────────────────────────────────────────────────────────
console.log('\nreset');
await run('cfgadj orbit up');             // leave something non-default on
await run('cfgreset');
const afterReset = await get(() => ({
  cfg: JSON.stringify(state.cfg), orbit: cfg('orbit'), gOrbit, galaxy: cfg('galaxy'),
}));
check('reset restores the defaults', afterReset.orbit === 0 && afterReset.galaxy === 1,
  JSON.stringify(afterReset));
check('reset also stops anything it turned off', afterReset.gOrbit === false,
  `gOrbit is ${afterReset.gOrbit} after reset`);

// ── persistence ────────────────────────────────────────────────────────────
console.log('\npersistence across a reload');
await run('cfgadj glow up');
await run('cfgadj orbit up');
const beforeReload = await get(() => ({ glow: cfg('glow'), orbit: cfg('orbit') }));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const afterReload = await get(() => ({ glow: cfg('glow'), orbit: cfg('orbit'), gOrbit }));
check('settings survive a reload',
  Math.abs(afterReload.glow - beforeReload.glow) < 1e-6 && afterReload.orbit === beforeReload.orbit,
  `${JSON.stringify(beforeReload)} -> ${JSON.stringify(afterReload)}`);
check('a remembered orbit setting is actually running after a reload',
  afterReload.orbit !== 1 || afterReload.gOrbit === true,
  `cfg says ${afterReload.orbit}, gOrbit is ${afterReload.gOrbit}`);

// ── idle stop: the graph must go quiet, and must wake reliably ─────────────
console.log('\nidle stop');
await run('cfgreset');
await run('graph inv');
await page.waitForTimeout(6000);            // let it settle fully

const framesWhenIdle = await get(async () => {
  let n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 1000) { await new Promise(r => requestAnimationFrame(r)); n++; }
  // how many times the app itself scheduled a frame, not how many the browser offered
  return { rafParked: gRAF === null, browserFrames: n };
});
check('the render loop parks itself when nothing is moving', framesWhenIdle.rafParked,
  'gRAF is still scheduled, so it is drawing a still picture forever');

// Waking is observed by counting DRAWS, not by catching gRAF mid-flight: waking
// schedules one frame, and if nothing is moving that frame parks the loop again, so
// gRAF is non-null for a few milliseconds at most.
await page.evaluate(() => {
  window.__draws = 0;
  const orig = window.gDraw;
  window.gDraw = function () { window.__draws++; return orig.apply(this, arguments); };
});

const pane = await (await page.$('#gcanvas')).boundingBox();
await page.evaluate(() => { window.__draws = 0; });
await page.waitForTimeout(600);
const idleDraws = await get(() => window.__draws);

await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
await page.mouse.move(pane.x + pane.width / 2 + 40, pane.y + pane.height / 2 + 20);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(400);
const wokenDraws = await get(() => window.__draws);

check('it stays quiet while untouched', idleDraws <= 2, `${idleDraws} draws in 600ms of idle`);
check('it wakes when the pointer interacts', wokenDraws > idleDraws,
  `draws went ${idleDraws} -> ${wokenDraws}`);

// switching views must wake it
await page.waitForTimeout(4000);
await run('graph projects');
const wokeOnView = await get(() => gRAF !== null);
check('it wakes when the view changes', wokeOnView);

// adding an item must wake it, or the graph would silently miss the change
await page.waitForTimeout(5000);
const parkedAgain = await get(() => gRAF === null);
await run('add idle canary x1 @4110');
await page.waitForTimeout(600);
const wokeOnData = await get(() => gRAF !== null || gAlpha > 0.015);
check('it wakes when the inventory changes', !parkedAgain || wokeOnData,
  `parked=${parkedAgain}, woke=${wokeOnData}`);

// and turning the setting off means it never parks
await run('cfgadj idleStop down');
await run('graph inv');
await page.waitForTimeout(6000);
check('with the setting off it keeps drawing', await get(() => gRAF !== null));

// ── display toggles reachable from the settings screen ────────────────────
console.log('\ndisplay toggles in settings');
await run('settings');
const screen = await page.textContent('#out');
for (const label of ['node cores', 'HUD frame', 'title bar', 'theme']) {
  check(`settings offers "${label}"`, screen.includes(label), screen.slice(0, 260));
}

// clicking one must flip it AND stay on the settings screen
const coresBefore = await get(() => gCores);
const coresRow = await page.$('[data-menu="run:__toggle cores"]');
check('the node-cores row is clickable', coresRow !== null);
if (coresRow) {
  await coresRow.click();
  await page.waitForTimeout(400);
  check('clicking it flips the toggle', (await get(() => gCores)) !== coresBefore);
  check('and stays on the settings screen',
    /SETTINGS/.test(await page.textContent('#out')),
    (await page.textContent('#out')).slice(0, 120));
  await (await page.$('[data-menu="run:__toggle cores"]')).click();   // put it back
}

// ── shop defaults ─────────────────────────────────────────────────────────
console.log('\nshop defaults');
await run('theme phosphor');
await run('cfgadj glow up');
const mine = await get(() => ({ theme: state.theme, glow: cfg('glow') }));
await run('__shopdefault');
const stored = await page.evaluate(async () => JSON.parse((await DB.meta('default_prefs')).value || '{}'));
check('saving writes the shop default to the server',
  stored.theme === mine.theme && stored.cfg && Math.abs(stored.cfg.glow - mine.glow) < 1e-6,
  JSON.stringify(stored));

// a device with no settings of its own starts from the shop default
// A separate CONTEXT, not just a new page: pages in one context share localStorage,
// so a new page would inherit this device's settings and prove nothing.
const freshCtx = await browser.newContext();
const fresh = await freshCtx.newPage();
await fresh.goto(BASE, { waitUntil: 'networkidle' });
await fresh.waitForTimeout(1200);
const inherited = await fresh.evaluate(() => ({ theme: state.theme, glow: cfg('glow') }));
check('a new device inherits the shop default',
  inherited.theme === mine.theme && Math.abs(inherited.glow - mine.glow) < 1e-6,
  `${JSON.stringify(mine)} -> ${JSON.stringify(inherited)}`);

// a device that already has settings keeps them
await fresh.evaluate(() => { state.theme = 'amber'; save(); });
await fresh.reload({ waitUntil: 'networkidle' });
await fresh.waitForTimeout(1000);
const kept = await fresh.evaluate(() => state.theme);
check('a configured device keeps its own settings', kept === 'amber', `theme is ${kept}`);
await fresh.close();
await freshCtx.close();

// ── the drift comes back after a drag ────────────────────────────────────────
// A drag has always stopped the auto-rotation; it used to stop it for good. These check
// that `spin resumes in` brings it back, that 0 still means never, and that the drift
// picks up the axis the drag was on.
await run('graph inv');
await run('cfgreset');
await run('graph 3d');          // the drift and the rotate drag are 3D-only
await page.waitForTimeout(400);

async function dragCanvas(dx, dy) {
  const box = await page.locator('#gcanvas').boundingBox();
  // Start well away from the middle: the centre of the graph is the hub node, and a
  // mousedown on a node drags the NODE. Rotating needs empty space.
  const cx = box.x + box.width * 0.12, cy = box.y + box.height * 0.18;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + dx * i / 6, cy + dy * i / 6);
  await page.mouse.up();
}

await page.evaluate(() => { setCfg('spinResume', 1); setCfg('driftSpeed', 0.0022); });
await dragCanvas(90, 0);
const stopped = await page.evaluate(() => gAutoRot);
check('a drag stops the auto-rotation', stopped === false, `gAutoRot=${stopped}`);

await page.waitForTimeout(1600);
const resumed = await page.evaluate(() => gAutoRot);
check('the spin resumes after the delay', resumed === true, `gAutoRot=${resumed}`);

const spun = await page.evaluate(async () => {
  const y0 = gYaw;
  await new Promise(r => setTimeout(r, 500));
  return Math.abs(gYaw - y0);
});
check('and the scene is actually turning again', spun > 1e-4, `yaw moved ${spun.toFixed(5)}`);

// 0 means never
await page.evaluate(() => setCfg('spinResume', 0));
await dragCanvas(90, 0);
await page.waitForTimeout(1600);
const never = await page.evaluate(() => gAutoRot);
check('spin resumes in = never leaves it stopped', never === false, `gAutoRot=${never}`);

// a vertical drag tilts the drift
await page.evaluate(() => { setCfg('spinResume', 1); setCfg('spinAxis', 1); });
await dragCanvas(0, -70);
await page.waitForTimeout(1600);
const tilt = await page.evaluate(async () => {
  const p0 = gPitch, y0 = gYaw;
  await new Promise(r => setTimeout(r, 600));
  return { dp: Math.abs(gPitch - p0), dy: Math.abs(gYaw - y0), ax: gSpinAx, ay: gSpinAy };
});
check('a vertical drag tilts the drift onto that axis',
  tilt.dp > 1e-4 && Math.abs(tilt.ay) > 0.5,
  `pitch moved ${tilt.dp.toFixed(5)}, axis=(${tilt.ax.toFixed(2)},${tilt.ay.toFixed(2)})`);

// at 0 the drift is level again no matter how it was dragged. auto-home has to be off
// for this one: homing also moves the pitch, and moving it is the whole point of it.
await page.evaluate(() => { setCfg('spinAxis', 0); setCfg('spinHome', 0); });
await dragCanvas(0, -70);
await page.waitForTimeout(1600);
const level = await page.evaluate(async () => {
  const p0 = gPitch;
  await new Promise(r => setTimeout(r, 600));
  return Math.abs(gPitch - p0);
});
check('spin follows drag = off keeps the drift level', level < 1e-6, `pitch moved ${level.toFixed(6)}`);

// auto-home: the tilt comes back to level, the yaw is left where it is
await page.evaluate(() => { setCfg('spinResume', 1); setCfg('spinHome', 1); });
await dragCanvas(0, -70);
const tilted = await page.evaluate(() => gPitch);
const home = await page.evaluate(async () => {
  const y0 = gYaw;
  await new Promise(r => setTimeout(r, 3000));
  return { pitch: gPitch, yawMoved: Math.abs(gYaw - y0), homing: gHoming };
});
check('auto-home brings the tilt back to level',
  Math.abs(home.pitch - (-0.35)) < 0.01 && Math.abs(tilted - (-0.35)) > 0.1,
  `pitch ${tilted.toFixed(3)} -> ${home.pitch.toFixed(3)}`);
check('auto-home leaves the yaw alone (it keeps spinning, not rewinding)',
  home.yawMoved > 1e-4, `yaw moved ${home.yawMoved.toFixed(5)}`);

// off, the tilt stays where it was dragged
await page.evaluate(() => setCfg('spinHome', 0));
await dragCanvas(0, -70);
await page.waitForTimeout(2500);
const stayed = await page.evaluate(() => gPitch);
check('auto-home off leaves the tilt where you put it',
  Math.abs(stayed - (-0.35)) > 0.05, `pitch ${stayed.toFixed(3)}`);

/* The rate must not depend on which way you left it pointing. Vertical rotation is
   damped because pitch has less room, and before normalising, a straight-up drag drifted
   visibly slower than a level one. Compare the on-screen angular rate both ways. */
await page.evaluate(() => { setCfg('spinHome', 0); setCfg('spinAxis', 1); });
async function driftRate() {
  return await page.evaluate(async () => {
    const y0 = gYaw, p0 = gPitch;
    await new Promise(r => setTimeout(r, 1000));
    return Math.hypot(gYaw - y0, (gPitch - p0)) ;
  });
}
// Drag DOWNWARD so the tilted drift heads away from the pitch limit. Toward it, the
// vertical component deliberately fades out as it runs out of room, so a measurement
// there reads the fade rather than the rate.
await dragCanvas(90, 0);
await page.waitForTimeout(1500);
const rateLevel = await driftRate();
await page.evaluate(() => { gPitch = -0.35; });
await dragCanvas(0, 60);
await page.waitForTimeout(1500);
const rateTilted = await driftRate();
const ratio = rateTilted / (rateLevel || 1);
check('the drift rate is the same whichever axis it was left on',
  ratio > 0.75 && ratio < 1.35, `level ${rateLevel.toFixed(4)} vs tilted ${rateTilted.toFixed(4)} (${ratio.toFixed(2)}x)`);

await run('cfgreset');

check('no page errors during the audit', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log('failed: ' + failures.join(', '));

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
process.exit(failures.length ? 1 : 0);
