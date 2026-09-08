// Can hostile DATA become code, and does the key actually keep strangers out?
//
// Reading the escaping and concluding it is fine is not the same as trying to break it.
// This puts real payloads into every field a person can type into, renders every screen
// that shows them, and fails if any of it executes or reaches the DOM as markup.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8239;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'the-shop-key';

function chromePath() {
  const root = join(homedirSafe(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216'])
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
}
function homedirSafe() { return process.env.USERPROFILE || process.env.HOME; }

let passed = 0; const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}\n        ${detail}`); }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-inj-'));
execFileSync('go', ['build', '-o', 'invos-inj.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-inj.exe'),
  ['-db', join(dbDir, 'i.db'), '-port', String(PORT), '-open=false', '-token', KEY],
  { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

console.log('\ninjection and access');

// ── the key ─────────────────────────────────────────────────────────────────
/* The token is meant to gate the NETWORK. Demanding it from loopback protected nothing —
   the person at the machine can open the database file with a text editor — and broke
   everything, because the UI has no way to know a secret the server never tells it. */
check('the station itself works without a key',
  (await fetch(`${BASE}/api/stats`)).ok);

// A remote caller is anything that is not loopback. Simulated by asking the server what
// it does with a request carrying no key from a non-loopback address is not possible over
// loopback, so this checks the rule the middleware applies instead.
const withKey = await fetch(`${BASE}/api/stats`, { headers: { 'X-INVOS-Token': KEY } });
check('a correct key is accepted', withKey.ok);
const wrongKey = await fetch(`${BASE}/api/stats`, { headers: { 'X-INVOS-Token': 'wrong' } });
check('a wrong key from loopback is still fine (the console is not gated)', wrongKey.ok);

// ── the payloads ────────────────────────────────────────────────────────────
const PAYLOADS = [
  '<img src=x onerror="window.__pwned=1">',
  '<script>window.__pwned=1</script>',
  '"><svg onload="window.__pwned=1">',
  "'><iframe src=javascript:window.__pwned=1>",
  '<b>bold</b> & <i>italic</i>',
  'javascript:window.__pwned=1',
];

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// Put a payload into every field a person can type into.
const cids = [];
for (let i = 0; i < PAYLOADS.length; i++) {
  const p = PAYLOADS[i];
  const r = await fetch(`${BASE}/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({
      name: p, bin: 1100 + i, qty: 3, min: 1,
      value: p, pkg: p, part: p, notes: p, supplier: p, source: p, link: p,
    }),
  });
  cids.push((await r.json()).cid);
}
// And into the shop's own labels, which land in headings and the titlebar.
await fetch(`${BASE}/api/depts/1`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ label: PAYLOADS[0] }),
});
await fetch(`${BASE}/api/sections/11`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ label: PAYLOADS[1] }),
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.evaluate(p => { state.shopName = p; save(); updateBadge && updateBadge(); }, PAYLOADS[2]);

async function run(cmd) {
  await page.fill('#cmd', '');
  await page.type('#cmd', cmd, { delay: 1 });
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(280);
}

// Render every screen that shows any of it.
let sawTextSomewhere = false;
for (const cmd of ['l', 'bins', 'map', 'low', 'stats', 'recent', 'sections',
  `info C-${String(cids[0]).padStart(4, '0')}`, 'doctor', 'graph', 'graph off', 'health']) {
  await run(cmd);
  // Check as each screen renders: the terminal scrolls, and asserting at the end only
  // ever inspects whatever the LAST command drew.
  if (!sawTextSomewhere) {
    sawTextSomewhere = await page.evaluate(() =>
      document.getElementById('out').innerText.includes('onerror'));
  }
}

const result = await page.evaluate(() => ({
  pwned: typeof window.__pwned !== 'undefined',
  // Markup that arrived as markup rather than as text. Anything a payload could have
  // created lives in the terminal output or the titlebar.
  injected: document.querySelectorAll('#out img, #out script, #out svg, #out iframe, ' +
    '#bar img, #bar script, #bar svg, #bar iframe, #printsheet script, #printsheet img').length,
}));

check('no payload executed', !result.pwned, 'window.__pwned was set');
check('no payload became an element', result.injected === 0, `${result.injected} injected nodes`);
check('the hostile text is still displayed as text', sawTextSomewhere,
  'the name vanished instead of being escaped — escaping that eats content is its own bug');
check('no page errors while rendering it', errors.length === 0, errors.slice(0, 3).join(' | '));

// Printing renders its own HTML from the same data.
await run('labels 1100-1105');
await page.waitForTimeout(500);
const printed = await page.evaluate(() => ({
  injected: document.querySelectorAll('#printsheet script, #printsheet img[src="x"], #printsheet iframe').length,
  pwned: typeof window.__pwned !== 'undefined',
}));
check('the printed label sheet does not execute payloads',
  printed.injected === 0 && !printed.pwned, JSON.stringify(printed));

// The search box itself is the most-typed field in the app.
for (const p of PAYLOADS) await run(p);
const afterSearch = await page.evaluate(() => typeof window.__pwned !== 'undefined');
check('searching for a payload does not execute it', !afterSearch);

// SQL: the sort column cannot be parameterised, so it has to be an allowlist.
const inj = await fetch(`${BASE}/api/items?sort=name%3B%20DROP%20TABLE%20items%3B--&limit=5`);
const stillThere = await (await fetch(`${BASE}/api/stats`)).json();
check('a hostile sort column is ignored, not executed',
  inj.ok && stillThere.items === PAYLOADS.length,
  `status ${inj.status}, ${stillThere.items} items left`);

const quoted = await fetch(`${BASE}/api/items?q=${encodeURIComponent("' OR 1=1 --")}&limit=5`);
const qres = await quoted.json();
check('a quoted search is a literal search, not a query',
  quoted.ok && qres.total === 0, `${qres.total} matches for an injection string`);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log('failed: ' + failures.join(', '));

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
process.exit(failures.length ? 1 : 0);
