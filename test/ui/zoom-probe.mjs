// Zooming in the first seconds after the graph opens gets undone.
//
// The auto-fit is supposed to stop the moment someone touches the camera, and the wheel
// handler does set that flag — so this records gScale and the flag together to find who
// clears it.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8231;
const BASE = `http://127.0.0.1:${PORT}`;
const ZOOM_AT = Number(process.argv[2] || 600);   // ms after the graph opens

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216'])
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-zoom-'));
execFileSync('go', ['build', '-o', 'invos-zoom.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\Program Files\Go\bin` },
});
const server = spawn(join(REPO, 'invos-zoom.exe'),
  ['-db', join(dbDir, 'z.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
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
  await page.waitForTimeout(300);
}
// Enough rows that the graph's own item fetch has not finished by the time someone
// reaches for the wheel — which is the window the glitch lives in.
const ITEMS = Number(process.argv[3] || 0);
if (ITEMS) {
  const items = [];
  for (let i = 0; i < ITEMS; i++)
    items.push({ name: `Part ${i}`, bin: (i % 10) * 1000 + ((i / 10 | 0) % 10) * 100 + (i % 80) + 10, qty: 5, min: 1 });
  for (let o = 0; o < items.length; o += 1000)
    await fetch(`${BASE}/api/items/bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.slice(o, o + 1000), source: 'zoom-probe' }),
    });
  await page.reload({ waitUntil: 'networkidle' });
} else {
  await run('__fr_demo');
}
await run('graph off');

// Instrument every place that can move the camera, so the culprit names itself.
await page.evaluate(() => {
  window.__ev = [];
  for (const fn of ['gFitView', 'setGraph', 'setGraphView', 'graphHome', 'buildGraphData', 'graphSync']) {
    const orig = window[fn];
    if (typeof orig !== 'function') continue;
    window[fn] = function (...a) {
      window.__ev.push({ t: Math.round(performance.now()), fn, scale: +gScale.toFixed(3), adj: gUserAdjusted });
      return orig.apply(this, a);
    };
  }
});

// Open showing only a slice, so raising the budget later genuinely adds nodes.
if (process.env.GROW) await page.evaluate(() => setCfg('graphNodes', 1000));

// Open the graph WITHOUT the usual settle wait: the glitch is in the first moments,
// and run() sleeps straight through them.
const t0 = await page.evaluate(() => performance.now());
await page.fill('#cmd', '');
await page.type('#cmd', 'graph 3d', { delay: 1 });
await page.press('#cmd', 'Enter');
await page.waitForTimeout(ZOOM_AT);

// WATCH=1: no wheel at all — just record what the camera does on its own after the
// graph opens. The complaint is a late zoom-OUT with nobody touching anything.
if (process.env.WATCH) {
  const trace = await page.evaluate(async () => {
    const ex = () => { let m = 0; for (const n of gNodes) m = Math.max(m, Math.hypot(n.x, n.y, n.z || 0)); return m; };
    const out = [];
    for (let i = 0; i < 60; i++) {
      out.push({ t: Math.round(performance.now()), s: +gScale.toFixed(3), e: +ex().toFixed(0),
                 n: gNodes.length, a: +gAlpha.toFixed(4), adj: gUserAdjusted });
      await new Promise(r => setTimeout(r, 200));
    }
    return out;
  });
  console.log('\n  t(ms)   scale   extent  nodes   alpha   what');
  let prev = null;
  for (const x of trace) {
    const note = prev && Math.abs(x.s - prev.s) > 0.01 ? '  <-- CAMERA MOVED' :
                 prev && x.n !== prev.n ? '  <-- nodes arrived' : '';
    console.log(`  ${String(x.t - Math.round(t0)).padStart(6)}  ${String(x.s).padStart(6)}  ` +
      `${String(x.e).padStart(6)}  ${String(x.n).padStart(5)}  ${String(x.a).padStart(6)}${note}`);
    prev = x;
  }
  await browser.close(); server.kill();
  await new Promise(r => server.on('exit', r));
  process.exit(0);
}

const box = await page.locator('#gcanvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);   // zoom IN
const zoomed = await page.evaluate(() => ({ scale: +gScale.toFixed(3), adj: gUserAdjusted }));

/* Force the condition the glitch lives in, deterministically: the graph opens with a
   small slice of the inventory and MORE nodes arrive afterwards, re-heating the layout
   and growing the content. Raising the node budget does exactly that on demand, where
   waiting for the real fetch is a race on a fast localhost. */
if (process.env.GROW) {
  await page.evaluate(async () => {
    setCfg('graphNodes', 20000);
    await new Promise(r => setTimeout(r, 2500));
  });
}

/* gScale is only half the picture. What you SEE is content extent x scale, and the
   force layout keeps expanding for a second or two after the graph opens — so a fixed
   scale shows a steadily smaller picture. Sample both. */
const extent = await page.evaluate(async () => {
  const ex = () => {
    let m = 0;
    for (const n of gNodes) m = Math.max(m, Math.hypot(n.x, n.y, n.z || 0));
    return m;
  };
  const out = [];
  for (let i = 0; i < 40; i++) {
    out.push({ t: Math.round(performance.now()), e: +ex().toFixed(0), s: +gScale.toFixed(3) });
    await new Promise(r => setTimeout(r, 100));
  }
  return out;
});

await page.waitForTimeout(400);
const after = await page.evaluate(() => ({ scale: +gScale.toFixed(3), adj: gUserAdjusted }));

console.log('\nwhat the eye sees = content extent x scale (apparent size on screen):');
const base = extent[0].e * extent[0].s;
for (let i = 0; i < extent.length; i += 4) {
  const x = extent[i];
  const app = x.e * x.s;
  console.log(`  +${String(x.t - Math.round(t0)).padStart(5)}ms  extent ${String(x.e).padStart(5)}` +
    `  scale ${String(x.s).padStart(6)}  apparent ${(app / base).toFixed(2)}x`);
}
const ev = await page.evaluate(() => window.__ev);

console.log(`\nzoomed in at +${ZOOM_AT}ms`);
console.log(`  scale right after the wheel : ${zoomed.scale}   userAdjusted=${zoomed.adj}`);
console.log(`  scale 4s later              : ${after.scale}   userAdjusted=${after.adj}`);
const kept = Math.abs(after.scale - zoomed.scale) < 0.01;
console.log(kept ? '  scale unchanged' : `  scale moved ${zoomed.scale} -> ${after.scale}`);

/* The real question is not whether gScale changed but whether the PICTURE did. The
   inventory arrives after the graph opens and the layout re-heats, so holding a fixed
   scale through that shows a steadily smaller picture — which is the reported glitch.
   Apparent size is content extent x scale. */
const first = extent[0], last = extent[extent.length - 1];
const appFirst = first.e * first.s, appLast = last.e * last.s;
const ratio = appLast / (appFirst || 1);
console.log(`
apparent size held: ${ratio.toFixed(2)}x  ` +
  `(extent ${first.e} -> ${last.e}, scale ${first.s} -> ${last.s})`);
console.log(ratio > 0.8 && ratio < 1.25
  ? '  PASS — what you zoomed to stayed the size you left it'
  : '  FAIL — the picture changed size under the user');
console.log('\ncamera events (time, fn, scale, userAdjusted):');
for (const e of ev) console.log(`  +${String(e.t - Math.round(t0)).padStart(5)}ms  ${e.fn.padEnd(15)} scale=${String(e.scale).padStart(6)} adj=${e.adj}`);

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
