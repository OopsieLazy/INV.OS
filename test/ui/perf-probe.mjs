// How fast does the station come up, and does it work on a tablet?
//
// The app is one embedded HTML file, so "load speed" is mostly one request plus whatever
// the page does before it is usable. This measures the request, the browser's own
// navigation timings, and the point at which someone could actually type — then checks
// the layout at phone, tablet and desktop sizes.
import { chromium, devices } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8236;
const BASE = `http://127.0.0.1:${PORT}`;
const ITEMS = Number(process.argv[2] || 5000);

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216'])
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
}

let passed = 0; const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}\n        ${detail}`); }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-perf-'));
execFileSync('go', ['build', '-o', 'invos-perf.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-perf.exe'),
  ['-db', join(dbDir, 'p.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

// A real shop's worth of stock, so the numbers are not from an empty database.
const items = [];
for (let i = 0; i < ITEMS; i++)
  items.push({ name: `Part ${i}`, bin: (i % 10) * 1000 + ((i / 10 | 0) % 10) * 100 + (i % 80) + 10, qty: 5, min: 1 });
for (let o = 0; o < items.length; o += 1000)
  await fetch(`${BASE}/api/items/bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.slice(o, o + 1000), source: 'perf' }),
  });

console.log(`\nINV.OS load + layout · ${ITEMS} items`);

// ── the payload ─────────────────────────────────────────────────────────────
const t0 = Date.now();
const res = await fetch(BASE + '/');
const body = await res.text();
const fetchMs = Date.now() - t0;
const enc = res.headers.get('content-encoding') || 'none';
const bytes = Buffer.byteLength(body);
console.log(`\npayload`);
console.log(`  index.html      ${(bytes / 1024).toFixed(0)} KB uncompressed · encoding: ${enc} · ${fetchMs}ms`);
const exeBytes = statSync(join(REPO, 'invos-perf.exe')).size;
console.log(`  the whole exe   ${(exeBytes / 1024 / 1024).toFixed(1)} MB`);

const reqs = [];
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });

async function measure(label, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('response', r => reqs.push(r.url()));
  const start = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  // Usable = the command line exists and accepts focus. That is the thing a person is
  // waiting for, not the load event.
  await page.waitForSelector('#cmd', { state: 'attached' });
  await page.evaluate(() => document.getElementById('cmd').focus());
  const usable = Date.now() - start;

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    const fp = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint');
    return {
      ttfb: Math.round(n.responseStart || 0),
      domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
      load: Math.round(n.loadEventEnd || 0),
      fcp: Math.round(fp ? fp.startTime : 0),
      requests: performance.getEntriesByType('resource').length,
    };
  });
  console.log(`\n${label}`);
  console.log(`  TTFB ${nav.ttfb}ms · first paint ${nav.fcp}ms · DOM ready ${nav.domContentLoaded}ms ` +
    `· load ${nav.load}ms · usable ${usable}ms · ${nav.requests} sub-resources`);
  return { page, ctx, nav, usable };
}

const desktop = await measure('desktop 1400x800', { viewport: { width: 1400, height: 800 } });

check('first paint is under 500ms', desktop.nav.fcp < 500, `${desktop.nav.fcp}ms`);
check('usable in under 1.5s with a full inventory', desktop.usable < 1500, `${desktop.usable}ms`);
check('the page pulls no third-party resources',
  reqs.every(u => u.startsWith(BASE)), reqs.filter(u => !u.startsWith(BASE)).slice(0, 3).join(', '));

await desktop.ctx.close();

// ── layout on the devices a shop actually uses ──────────────────────────────
for (const [label, opts] of [
  ['phone (iPhone 13)', devices['iPhone 13']],
  ['tablet (iPad Mini landscape)', devices['iPad Mini landscape']],
]) {
  const ctx = await browser.newContext({ ...opts });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { window.exec && exec('graph'); } catch (e) {} });
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    const cmd = document.getElementById('cmd');
    const pane = document.getElementById('graphpane');
    const btn = document.querySelector('.barbtn');
    const cs = getComputedStyle(cmd);
    return {
      // A page that scrolls sideways on a phone is the classic "not mobile friendly".
      hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inputPx: parseFloat(cs.fontSize),
      stacked: pane && getComputedStyle(document.getElementById('main')).flexDirection === 'column',
      paneW: pane ? pane.getBoundingClientRect().width : 0,
      pageW: document.documentElement.clientWidth,
      btnH: btn ? btn.getBoundingClientRect().height : 0,
    };
  });
  console.log(`\n${label}  ${m.pageW}px wide`);
  console.log(`  graph pane ${Math.round(m.paneW)}px · stacked ${m.stacked} · ` +
    `input ${m.inputPx}px · button ${Math.round(m.btnH)}px`);

  if (m.hScroll > 1) {
    // Name the element rather than guessing: whatever is wider than the viewport is
    // the thing to fix, and it is rarely the one you would assume.
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')]
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(x => x.r.width > w + 1 || x.r.right > w + 1)
        .slice(0, 6)
        .map(x => `${x.el.tagName.toLowerCase()}#${x.el.id || ''}.${x.el.className || ''} ` +
          `w=${Math.round(x.r.width)} right=${Math.round(x.r.right)}`);
    });
    console.log('  widest offenders:', wide.join(' | ') || '(none found)');
  }
  check(`${label}: the page does not scroll sideways`, m.hScroll <= 1, `overflow ${m.hScroll}px`);
  check(`${label}: the command input is 16px+ (iOS does not zoom the page)`,
    m.inputPx >= 16, `${m.inputPx}px`);
  check(`${label}: touch targets are at least 32px`, m.btnH >= 32, `${Math.round(m.btnH)}px`);
  if (m.pageW < 760) {
    check(`${label}: the graph stacks instead of splitting`, m.stacked, `flexDirection not column`);
  } else {
    check(`${label}: the graph keeps a usable width`, m.paneW > 200, `${Math.round(m.paneW)}px`);
  }
  await ctx.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log('failed: ' + failures.join(', '));

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
process.exit(failures.length ? 1 : 0);
