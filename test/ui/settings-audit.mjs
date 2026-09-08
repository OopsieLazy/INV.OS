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

check('no page errors during the audit', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log('failed: ' + failures.join(', '));

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
process.exit(failures.length ? 1 : 0);
