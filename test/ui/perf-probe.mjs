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
  // On a phone the bar buttons start hidden, so the visible touch target is the handle.
  // Measuring a deliberately hidden element and calling it a regression is the test being
  // wrong, not the product.
  // 30px on a phone: the bar is always visible now, so every button has to fit across
  // the width without scrolling, and that caps how tall they can reasonably be.
  const minTouch = m.pageW < 760 ? 30 : 32;
  check(`${label}: touch targets are big enough to hit`, m.btnH >= minTouch,
    `${Math.round(m.btnH)}px, want ${minTouch}`);

  if (m.pageW < 760) {
    /* On a phone you should only ever scroll DOWN. Pre-formatted terminal lines drag the
       view sideways otherwise, and a screen you have to scan in two directions to read is
       worse than one with ragged columns. */
    const wrap = await page.evaluate(async () => {
      await exec('l');
      await new Promise(r => setTimeout(r, 600));
      const term = document.getElementById('term');
      const line = document.querySelector('#out .line');
      return {
        termScroll: term.scrollWidth - term.clientWidth,
        pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wraps: line ? getComputedStyle(line).whiteSpace : 'none',
      };
    });
    check(`${label}: a long listing does not scroll sideways`,
      wrap.termScroll <= 1 && wrap.pageScroll <= 1,
      `terminal ${wrap.termScroll}px, page ${wrap.pageScroll}px, white-space ${wrap.wraps}`);

    /* The furniture hides, each half independently, and the HUD is NOT furniture. */
    await page.evaluate(() => exec('graph inv'));
    await page.waitForTimeout(1200);

    const chrome0 = await page.evaluate(() => {
      const vis = el => el && getComputedStyle(el).display !== 'none';
      return {
        barHidden: document.body.classList.contains('bar-hide'),
        gbtnsHidden: document.body.classList.contains('gbtns-hide'),
        hudTop: vis(document.getElementById('hud-top')),
        hudBot: vis(document.getElementById('hud-bot')),
        shopName: vis(document.getElementById('barl')),
      };
    });
    /* The bar STAYS. Hiding it moved the layout every time it came and went, and a row
       that jumps while you are aiming at it reads as a mis-tap. Only the graph buttons
       toggle, and they fade in place rather than taking space back. */
    check(`${label}: the top bar is always there, and the graph buttons start hidden`,
      !chrome0.barHidden && chrome0.gbtnsHidden, JSON.stringify(chrome0));

    // Everything on the bar has to fit across the width — no sideways scroll.
    const barFits = await page.evaluate(() => {
      const b = document.getElementById('bar');
      return { overflow: b.scrollWidth - b.clientWidth, buttons: b.querySelectorAll('.barbtn').length };
    });
    check(`${label}: the whole bar fits without scrolling`,
      barFits.overflow <= 1 && barFits.buttons >= 4, JSON.stringify(barFits));
    check(`${label}: the HUD readout is NOT hidden with them`,
      chrome0.hudTop && chrome0.hudBot, JSON.stringify(chrome0));
    check(`${label}: the shop name is dropped from the bar, leaving the buttons`,
      !chrome0.shopName, JSON.stringify(chrome0));

    // Double-tap each half; each must toggle only its own furniture.
    const dbl = async (sel, pos) => {
      for (let i = 0; i < 2; i++) {
        await page.locator(sel).click({ position: pos });
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(250);
    };
    // Tapping around the terminal must not move anything any more.
    const beforeTaps = await page.evaluate(() =>
      document.getElementById('graphpane').getBoundingClientRect().top);
    await dbl('#term', { x: 40, y: 60 });
    const afterTaps = await page.evaluate(() => ({
      paneTop: document.getElementById('graphpane').getBoundingClientRect().top,
      barHidden: document.body.classList.contains('bar-hide'),
    }));
    check(`${label}: tapping the terminal no longer hides the bar or moves the panes`,
      !afterTaps.barHidden && Math.abs(afterTaps.paneTop - beforeTaps) < 2,
      JSON.stringify({ beforeTaps, ...afterTaps }));

    /* The graph takes a SINGLE tap, because the canvas already knows whether the gesture
       moved — so a tap can be told from a rotate, which is what makes one tap safe there
       and not in the terminal. */
    await page.locator('#gcanvas').tap({ position: { x: 25, y: 25 } });
    await page.waitForTimeout(300);
    const afterGraph = await page.evaluate(() => ({
      bar: !document.body.classList.contains('bar-hide'),
      gbtns: !document.body.classList.contains('gbtns-hide'),
    }));
    check(`${label}: one tap on the graph shows its buttons, independently`,
      afterGraph.gbtns && afterGraph.bar, JSON.stringify(afterGraph));

    // A rotate must NOT be read as a tap.
    const box2 = await page.locator('#gcanvas').boundingBox();
    await page.touchscreen.tap(box2.x + 30, box2.y + 30);   // put them away first
    await page.waitForTimeout(250);
    const beforeDrag = await page.evaluate(() =>
      document.body.classList.contains('gbtns-hide'));
    await page.locator('#gcanvas').dragTo(page.locator('#gcanvas'), {
      sourcePosition: { x: 40, y: 40 }, targetPosition: { x: 140, y: 90 },
    });
    await page.waitForTimeout(300);
    const afterDrag = await page.evaluate(() =>
      document.body.classList.contains('gbtns-hide'));
    check(`${label}: dragging the graph does not toggle them`,
      beforeDrag === afterDrag, `hidden ${beforeDrag} -> ${afterDrag}`);

    // The buttons live down the side on a phone, not across the top.
    const btnLayout = await page.evaluate(() => {
      document.body.classList.remove('gbtns-hide');
      const g = document.getElementById('gbtns');
      const r = g.getBoundingClientRect();
      return { dir: getComputedStyle(g).flexDirection, tall: r.height > r.width };
    });
    check(`${label}: the graph buttons stack down the side`,
      btnLayout.dir === 'column' && btnLayout.tall, JSON.stringify(btnLayout));

    // And the panes can be swapped.
    const swapped = await page.evaluate(async () => {
      const pane = document.getElementById('graphpane');
      const before = pane.getBoundingClientRect().top;
      setCfg('graphFirst', 1);
      await new Promise(r => setTimeout(r, 400));
      const after = pane.getBoundingClientRect().top;
      setCfg('graphFirst', 0);
      return { before, after };
    });
    check(`${label}: the graph can be moved above the terminal`,
      swapped.after < swapped.before,
      `graph top ${Math.round(swapped.before)} -> ${Math.round(swapped.after)}`);

    /* The bar spans the width instead of bunching in a corner: every button takes an
       equal share, which is both a nav bar and the widest each target can be. */
    const spread = await page.evaluate(() => {
      const bar = document.getElementById('bar');
      const btns = [...bar.querySelectorAll('.barbtn, .warnpill')];
      const rs = btns.map(b => b.getBoundingClientRect());
      const barR = bar.getBoundingClientRect();
      const widths = rs.map(r => r.width);
      return {
        n: btns.length,
        leftGap: rs.length ? rs[0].left - barR.left : 0,
        rightGap: rs.length ? barR.right - rs[rs.length - 1].right : 0,
        spread: (Math.max(...widths) - Math.min(...widths)) / Math.max(...widths),
        barW: barR.width,
      };
    });
    check(`${label}: the bar buttons span the width, not bunched in a corner`,
      spread.leftGap < spread.barW * 0.25 && spread.rightGap < spread.barW * 0.25,
      JSON.stringify(spread));
    check(`${label}: and they share the width evenly`,
      spread.spread < 0.35, JSON.stringify(spread));

    /* While the keyboard is up the graph folds away, because a search you cannot see the
       results of is a search that did not happen. */
    const typing = await page.evaluate(async () => {
      const pane = document.getElementById('graphpane');
      const term = document.getElementById('term');
      const before = { pane: pane.getBoundingClientRect().height,
                       term: term.getBoundingClientRect().height };
      document.body.classList.add('kbd');       // what the keyboard handler does
      await new Promise(r => setTimeout(r, 320));
      const after = { pane: pane.getBoundingClientRect().height,
                      term: term.getBoundingClientRect().height };
      document.body.classList.remove('kbd');
      await new Promise(r => setTimeout(r, 320));
      const back = pane.getBoundingClientRect().height;
      return { before, after, back };
    });
    check(`${label}: the graph folds away while typing`,
      typing.after.pane < 2 && typing.before.pane > 40,
      JSON.stringify(typing));
    check(`${label}: and the terminal gets that space, so results are visible`,
      typing.after.term > typing.before.term + 40, JSON.stringify(typing));
    check(`${label}: the graph comes back when the keyboard goes`,
      Math.abs(typing.back - typing.before.pane) < 4, JSON.stringify(typing));

    /* `settings` is a page, not terminal output — on a phone it takes the whole display
       rather than scrolling a long list through a half-height window. */
    const settingsScreen = await page.evaluate(async () => {
      const pane = document.getElementById('graphpane');
      const term = document.getElementById('term');
      await exec('settings');
      await new Promise(r => setTimeout(r, 500));
      const during = { pane: pane.getBoundingClientRect().height,
                       term: term.getBoundingClientRect().height,
                       marked: document.body.classList.contains('screen-full') };
      await exec('graph inv');           // any other command hands the display back
      await new Promise(r => setTimeout(r, 600));
      return { during, after: pane.getBoundingClientRect().height,
               cleared: !document.body.classList.contains('screen-full') };
    });
    check(`${label}: the settings screen takes the whole display`,
      settingsScreen.during.marked && settingsScreen.during.pane < 2,
      JSON.stringify(settingsScreen));
    check(`${label}: and the next command gives the graph back`,
      settingsScreen.cleared && settingsScreen.after > 40, JSON.stringify(settingsScreen));

    // Terminal text scales down so a shelf tree fits instead of wrapping.
    const fs = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.getElementById('term')).fontSize));
    check(`${label}: the terminal text is scaled down to fit`,
      fs >= 10 && fs <= 12.5, `${fs}px`);

    // The prompt has to stay reachable while you scroll back through a long listing.
    const sticky = await page.evaluate(async () => {
      await exec('l');
      await new Promise(r => setTimeout(r, 700));
      const term = document.getElementById('term');
      term.scrollTop = 0;                       // scroll right back up
      await new Promise(r => setTimeout(r, 120));
      const pr = document.getElementById('promptrow').getBoundingClientRect();
      const tr = term.getBoundingClientRect();
      return {
        scrolledUp: term.scrollTop < 5,
        promptOnScreen: pr.bottom <= tr.bottom + 2 && pr.top >= tr.top - 2,
        canScroll: term.scrollHeight > term.clientHeight + 5,
      };
    });
    check(`${label}: you can scroll back up through the output`,
      sticky.canScroll && sticky.scrolledUp, JSON.stringify(sticky));
    check(`${label}: and the prompt stays put while you do`,
      sticky.promptOnScreen, JSON.stringify(sticky));
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
