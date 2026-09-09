// The README image.
//
// It is the single most valuable asset in the repo: it is what makes somebody stop
// scrolling, and it is the first thing they judge. So it is captured from the DEMO — the
// same curated seed a visitor sees, with real projects sharing real parts — rather than
// from a synthetic 20k-item stress run that looks impressive and is not what anyone gets.
//
//   node hero-shot.mjs            -> docs/galaxy.png
//   node hero-shot.mjs inv        -> docs/inventory.png
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '../..');
const DEMO = join(REPO, 'dist/demo/index.html');
const VIEW = (process.argv[2] || 'galaxy').toLowerCase();

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216'])
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
}

execFileSync('bash', ['demo/build-demo.sh'], { cwd: REPO, stdio: 'inherit' });
mkdirSync(join(REPO, 'docs'), { recursive: true });

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
// 2x, because this ends up on a retina screen and a soft hero image reads as amateur.
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(DEMO).href, { waitUntil: 'load' });
await page.waitForTimeout(1500);

async function run(cmd) {
  await page.fill('#cmd', '');
  await page.type('#cmd', cmd, { delay: 1 });
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(400);
}

// Leave the tour: a screenshot with "1/6 try: find resistor" in it is a screenshot of
// onboarding, not of the product.
await run('skip');
await run('graph 3d');
await run(VIEW === 'inv' ? 'graph inv' : 'graph galaxy');
await run('graph full');

// Orbits on, and generous glow — this is the one context where the show mode is the point.
await page.evaluate(() => {
  setCfg('orbit', 1);
  setCfg('glow', 1.4);
  setCfg('dust', 1);
  setCfg('orbitSpeed', 1);
  /* Push part labels back so only the SHELF hubs are named. At the default the part
     names collide into each other at this zoom — "Steel flat bar" over "Aluminium 6061
     bar" — and a wall of overlapping text hides the one thing the picture is for, which
     is the shape. The hubs alone say what you are looking at. */
  setCfg('labelZoom', 2.5);
});

// Let the layout settle and the orbits take over, then hold still. Capturing mid-settle
// gets a knot of overlapping nodes; capturing after the handoff gets the picture people
// actually see.
await page.waitForTimeout(9000);

// Freeze motion for the capture itself so nothing is blurred between frames, and park the
// camera at a slight tilt — dead-on is flat, and too much tilt hides the structure.
await page.evaluate(() => {
  gAutoRot = false;
  gPitch = -0.42;
  // Fill the frame. The auto-fit leaves a wide margin so nothing ever clips during
  // normal use; for a still, that margin is just wasted picture.
  gScale *= 1.35;
  gWake();
});
await page.waitForTimeout(900);

const out = join(REPO, 'docs', VIEW === 'inv' ? 'inventory.png' : 'galaxy.png');
await page.screenshot({ path: out });

const stats = await page.evaluate(() => ({
  nodes: typeof gNodes === 'undefined' ? 0 : gNodes.length,
  view: gView.kind,
}));
console.log(`\nwrote ${out}`);
console.log(`  ${stats.nodes} nodes · view ${stats.view} · 1600x900 @2x`);
console.log('  check it before committing: a hero image is judged in one second.');

await browser.close();
