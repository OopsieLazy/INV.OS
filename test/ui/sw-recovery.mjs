// Proves a browser profile that already has the OLD cache-first service worker
// installed recovers on its own and starts seeing new builds.
//
// This is the state a real user is in after running any build up to v22.2: the old
// worker is the thing serving the page, so the fixed code cannot run until that worker
// lets go of it. "It should update" is a guess; this checks.
//
//   node sw-recovery.mjs
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const UI = join(REPO, 'internal/web/ui/index.html');
const SW = join(REPO, 'internal/web/ui/sw.js');
const PORT = 8216;
const BASE = `http://127.0.0.1:${PORT}`;
const MARKER = '__RECOVERY_PROBE__';

// The service worker as it was before it was retired: cache-first over everything but
// /api/, keyed to a version name that only ever changed by hand.
const OLD_SW = `const CACHE = "invos-v4";
const ASSETS = ["./", "./index.html"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
    return res;
  })));
});
`;

const OLD_REG = `if (isSecure && "serviceWorker" in navigator)
  addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));`;

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
const build = () => execFileSync('go', ['build', '-o', 'invos-recover.exe', './cmd/invos'], {
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

const realUI = readFileSync(UI, 'utf8');
const realSW = readFileSync(SW, 'utf8');
const dbDir = mkdtempSync(join(tmpdir(), 'invos-rec-'));
const profile = mkdtempSync(join(tmpdir(), 'invos-recprof-'));
let server, ctx;

try {
  // ── build 1: the old world. Cache-first worker, registered on load. ──
  console.log('build 1 — the OLD cache-first worker…');
  const teardownStart = realUI.indexOf('/* No service worker in this build.');
  const teardownEnd = realUI.indexOf('\n}', realUI.indexOf('a browser that refuses this is no worse off')) + 2;
  if (teardownStart < 0 || teardownEnd < 2) throw new Error('could not find the teardown block to swap out');
  writeFileSync(SW, OLD_SW, 'utf8');
  writeFileSync(UI, realUI.slice(0, teardownStart) + OLD_REG + realUI.slice(teardownEnd), 'utf8');
  build();

  server = spawn(join(REPO, 'invos-recover.exe'),
    ['-db', join(dbDir, 'r.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
  await waitUp();

  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(), headless: true,
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);          // let the old worker install and claim

  const installed = await page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then(r => r.length));
  check('the old worker is installed (the state a real user is in)', installed > 0,
    `${installed} registrations`);

  // ── build 2: the fix, plus a marker so we can see whether it arrives ──
  console.log('\nbuild 2 — the retiring worker + a changed UI…');
  server.kill();
  await new Promise(r => server.on('exit', r));
  writeFileSync(SW, realSW, 'utf8');
  writeFileSync(UI, realUI.replace('<title>INV.OS</title>',
    `<title>INV.OS</title><!-- ${MARKER} -->`), 'utf8');
  build();
  server = spawn(join(REPO, 'invos-recover.exe'),
    ['-db', join(dbDir, 'r.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
  await waitUp();

  // What a user does: open the app again. Allow a couple of loads, because the
  // retiring worker has to activate before the page it serves can change.
  let html = '';
  for (let i = 0; i < 4; i++) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    html = await page.content();
    if (html.includes(MARKER)) break;
  }
  check('the profile recovers and sees the new build', html.includes(MARKER),
    'still serving the cached old UI after four reloads');

  const left = await page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then(r => r.length));
  check('the old worker unregistered itself', left === 0, `${left} still registered`);

  const cacheCount = await page.evaluate(() => window.caches.keys().then(k => k.length));
  check('its caches are gone', cacheCount === 0, `${cacheCount} caches left`);
} finally {
  writeFileSync(UI, realUI, 'utf8');
  writeFileSync(SW, realSW, 'utf8');
  if (ctx) await ctx.close();
  if (server) { server.kill(); await new Promise(r => server.on('exit', r)); }
  build();
  for (const d of [dbDir, profile]) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
