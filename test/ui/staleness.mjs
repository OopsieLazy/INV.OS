// Proves a UI change reaches a browser profile that has ALREADY opened the app.
//
// This is the bug that made the sections-graph fix look like it had not worked: the
// service worker cached the shell under a version name that only changed by hand, so a
// profile which had opened the app once kept serving the old UI forever. A fresh
// browser context (what smoke.mjs uses) can never catch that — it has no cache yet.
//
//   node staleness.mjs
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const UI = join(REPO, 'internal/web/ui/index.html');
const PORT = 8215;
const BASE = `http://127.0.0.1:${PORT}`;
const MARKER = '__STALENESS_PROBE__';

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
  }
}

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  ok ? passed++ : failed++;
};

const build = () => execFileSync('go', ['build', '-o', 'invos-stale.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server never came up');
}

const original = readFileSync(UI, 'utf8');
const dbDir = mkdtempSync(join(tmpdir(), 'invos-stale-'));
const profile = mkdtempSync(join(tmpdir(), 'invos-profile-'));
let server, ctx;

try {
  console.log('build 1 (the UI as it is)…');
  build();
  server = spawn(join(REPO, 'invos-stale.exe'),
    ['-db', join(dbDir, 's.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
  await waitUp();

  // A PERSISTENT profile is the whole point — this is what the app window uses.
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(), headless: true,
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);   // give any worker time to install

  check('first load has no marker', !(await page.content()).includes(MARKER));

  // Now ship a "new build" with a marker in it.
  console.log('\nbuild 2 (one line changed)…');
  server.kill();
  await new Promise(r => server.on('exit', r));
  writeFileSync(UI, original.replace('<title>INV.OS</title>',
    `<title>INV.OS</title><!-- ${MARKER} -->`), 'utf8');
  build();
  server = spawn(join(REPO, 'invos-stale.exe'),
    ['-db', join(dbDir, 's.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
  await waitUp();

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  let html = await page.content();
  if (!html.includes(MARKER)) {           // a retiring worker reloads once itself
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    html = await page.content();
  }

  check('a profile that already opened the app gets the NEW build', html.includes(MARKER),
    'still serving the old UI — a cache is holding it');

  const workers = await page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then(r => r.length));
  check('no service worker is left registered', workers === 0, `${workers} registered`);

  const caches = await page.evaluate(() => window.caches.keys().then(k => k.length));
  check('no caches are left behind', caches === 0, `${caches} caches`);
} finally {
  writeFileSync(UI, original, 'utf8');       // always restore the real UI
  if (ctx) await ctx.close();
  if (server) { server.kill(); await new Promise(r => server.on('exit', r)); }
  build();                                   // leave a binary matching the real source
  for (const d of [dbDir, profile]) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
