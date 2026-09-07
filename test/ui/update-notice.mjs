// Proves an already-open window notices when the server has been replaced by a newer
// build, instead of silently showing the old app.
//
// This cost two rounds of debugging: a fix was shipped, the window kept showing the
// previous UI because a loaded page does not reload itself, and the fix looked broken.
//
//   node update-notice.mjs
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const UI = join(REPO, 'internal/web/ui/index.html');
const PORT = 8217;
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

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  ok ? passed++ : failed++;
};
const build = () => execFileSync('go', ['build', '-o', 'invos-upd.exe', './cmd/invos'], {
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
const dbDir = mkdtempSync(join(tmpdir(), 'invos-upd-'));
let server, browser;

try {
  build();
  server = spawn(join(REPO, 'invos-upd.exe'),
    ['-db', join(dbDir, 'u.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
  await waitUp();

  const buildA = (await (await fetch(`${BASE}/api/server`)).json()).build;

  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  check('the page records the build it loaded with',
    (await page.evaluate(() => loadedBuild)) === buildA,
    `page has ${await page.evaluate(() => loadedBuild)}, server served ${buildA}`);
  check('no update notice while the server is unchanged',
    (await page.evaluate(() => updateReady)) === false);

  // Ship a different UI under the open window, exactly as a rebuild does.
  server.kill();
  await new Promise(r => server.on('exit', r));
  writeFileSync(UI, realUI.replace('<title>INV.OS</title>',
    '<title>INV.OS</title><!-- changed -->'), 'utf8');
  build();
  server = spawn(join(REPO, 'invos-upd.exe'),
    ['-db', join(dbDir, 'u.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
  await waitUp();

  const buildB = (await (await fetch(`${BASE}/api/server`)).json()).build;
  check('a UI change produces a different build id', buildA !== buildB,
    `${buildA} vs ${buildB}`);

  // The page is still open on the old build. It should notice by itself.
  await page.evaluate(() => refreshServerInfo());
  await page.waitForTimeout(500);

  check('the open window notices the server moved on',
    (await page.evaluate(() => updateReady)) === true,
    'it kept showing the old build with no warning');
  check('it says so on screen',
    /newer build/i.test(await page.textContent('#out')),
    (await page.textContent('#out')).slice(-200));
  check('an update pill appears in the title bar',
    (await page.$('#pupd')) !== null);

  // and reloading clears it
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('reloading picks up the new build and clears the notice',
    (await page.evaluate(() => loadedBuild)) === buildB &&
    (await page.evaluate(() => updateReady)) === false);
} finally {
  writeFileSync(UI, realUI, 'utf8');
  if (browser) await browser.close();
  if (server) { server.kill(); await new Promise(r => server.on('exit', r)); }
  build();
  try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
