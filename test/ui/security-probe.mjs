// Security checks against the real server.
//
// The threat is not the internet — the app is not on it. It is the shop's own network: a
// laptop someone brought in, a phone on the guest wifi, a machine that picked something
// up. The station must not become a way for any of those to reach the inventory, and it
// must not hand out anything about the box it runs on.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8237;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token-value';

let passed = 0; const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}\n        ${detail}`); }
}

const dbDir = mkdtempSync(join(tmpdir(), 'invos-sec-'));
execFileSync('go', ['build', '-o', 'invos-sec.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-sec.exe'),
  ['-db', join(dbDir, 's.db'), '-port', String(PORT), '-open=false', '-token', TOKEN],
  { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`, { headers: { 'X-INVOS-Token': TOKEN } })).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

const auth = { 'X-INVOS-Token': TOKEN };
const json = { 'Content-Type': 'application/json', ...auth };

console.log('\nsecurity');

// ── headers ─────────────────────────────────────────────────────────────────
const head = await fetch(BASE + '/', { headers: auth });
const h = n => head.headers.get(n) || '';

check('a content security policy is sent', h('content-security-policy').includes("default-src 'self'"),
  h('content-security-policy').slice(0, 80));
check('the page cannot be framed (clickjacking)',
  h('x-frame-options') === 'DENY' && h('content-security-policy').includes("frame-ancestors 'none'"));
check('content types are not sniffed', h('x-content-type-options') === 'nosniff');
check('no referrer leaks to anywhere', h('referrer-policy') === 'no-referrer');
check('the camera is allowed but nothing else is',
  /camera=\(self\)/.test(h('permissions-policy')) && /geolocation=\(\)/.test(h('permissions-policy')),
  h('permissions-policy'));
check('a script that got in could not phone home',
  h('content-security-policy').includes("connect-src 'self'") &&
  h('content-security-policy').includes("form-action 'none'"));
// HSTS on plain http would be meaningless, and on a LAN hostname it would poison every
// other service on that host for a year.
check('HSTS is NOT sent over plain http', h('strict-transport-security') === '',
  h('strict-transport-security'));

// ── the token ───────────────────────────────────────────────────────────────
check('no token is refused', (await fetch(BASE + '/api/stats')).status === 401);
check('a wrong token is refused',
  (await fetch(BASE + '/api/stats', { headers: { 'X-INVOS-Token': 'wrong' } })).status === 401);
check('the right token is accepted', (await fetch(BASE + '/api/stats', { headers: auth })).ok);

// The token must never be readable from the front end — a device that does not have it
// must not be able to ask for it.
const info = await (await fetch(BASE + '/api/server', { headers: auth })).json();
const infoText = JSON.stringify(info);
check('the server never sends the token to the page',
  !infoText.includes(TOKEN) && info.tokenSet === true, infoText.slice(0, 200));
check('no secret-looking field is exposed at all',
  !/"(token|secret|password|key)"\s*:\s*"[^"]+"/i.test(infoText), infoText.slice(0, 200));

// ── cross-site request forgery ──────────────────────────────────────────────
// A page on another site cannot read our replies, but it could still SEND — changing the
// shop's stock from a tab someone left open.
const csrf = await fetch(BASE + '/api/items', {
  method: 'POST',
  headers: { ...json, 'Sec-Fetch-Site': 'cross-site', Origin: 'http://evil.example' },
  body: JSON.stringify({ name: 'csrf widget', bin: 1101, qty: 1 }),
});
check('a cross-site POST is refused', csrf.status === 403, `status ${csrf.status}`);

const csrfOrigin = await fetch(BASE + '/api/items', {
  method: 'POST',
  headers: { ...json, Origin: 'http://evil.example' },
  body: JSON.stringify({ name: 'csrf widget 2', bin: 1101, qty: 1 }),
});
check('a POST from a foreign Origin is refused (older browsers)',
  csrfOrigin.status === 403, `status ${csrfOrigin.status}`);

const same = await fetch(BASE + '/api/items', {
  method: 'POST',
  headers: { ...json, 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ name: 'legit widget', bin: 1101, qty: 1 }),
});
check('a same-origin POST still works', same.status === 201, `status ${same.status}`);

const stats = await (await fetch(BASE + '/api/stats', { headers: auth })).json();
check('the refused writes never reached the database', stats.items === 1, `${stats.items} items`);

// A cross-site GET is left alone: none of ours change anything, and refusing them would
// break tools for no gain.
check('a cross-site GET is still allowed (it changes nothing)',
  (await fetch(BASE + '/api/stats', { headers: { ...auth, 'Sec-Fetch-Site': 'cross-site' } })).ok);

// ── flooding ────────────────────────────────────────────────────────────────
// Not just malice: a device stuck in a retry loop can take a shop's station down.
const burst = await Promise.all(
  Array.from({ length: 600 }, () => fetch(BASE + '/api/health', { headers: auth }).then(r => r.status).catch(() => 0)));
const limited = burst.filter(s => s === 429).length;
const served = burst.filter(s => s === 200).length;
console.log(`  burst of 600: ${served} served, ${limited} refused`);
check('a flood is rate limited', limited > 0, `${limited} refused`);
check('but a real burst of work still gets through', served >= 200, `${served} served`);

// And the limit must recover, or one bad minute would lock the shop out of its own
// inventory for good.
await new Promise(r => setTimeout(r, 1500));
check('the limit recovers after a pause',
  (await fetch(BASE + '/api/health', { headers: auth })).ok);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log('failed: ' + failures.join(', '));

server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
process.exit(failures.length ? 1 : 0);
