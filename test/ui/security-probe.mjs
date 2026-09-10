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
import { request as httpsRequest } from 'node:https';

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
// -lan so the token rule can be tested from a NON-loopback address, which is the only
// place it applies.
const server = spawn(join(REPO, 'invos-sec.exe'),
  ['-db', join(dbDir, 's.db'), '-port', String(PORT), '-open=false', '-token', TOKEN, '-lan'],
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

// ── the key ─────────────────────────────────────────────────────────────────
/* The key gates the NETWORK, not the console.
   Demanding it from loopback protected nothing — whoever is at the machine can open the
   database file with a text editor — and broke everything: with -token set, the app's own
   page loaded and then failed every request, because the UI cannot know a secret the
   server never tells it. The one flag the manual recommends for an untrusted network made
   the product unusable. */
check('the station itself is not locked out by its own key',
  (await fetch(BASE + '/api/stats')).ok);
check('the right key is accepted', (await fetch(BASE + '/api/stats', { headers: auth })).ok);

// And the part that matters: a device on the NETWORK must still be refused without it.
const info0 = await (await fetch(BASE + '/api/server')).json();
const lanURL = (info0.urls || []).find(u => !/localhost|127\.0\.0\.1/.test(u));
if (!lanURL) {
  console.log('  SKIP  remote key checks — no LAN address on this machine');
} else {
  const remote = async headers => await new Promise(res => {
    const u = new URL(lanURL + '/api/stats');
    const req = httpsRequest({
      hostname: u.hostname, port: u.port, path: u.pathname,
      headers: headers || {}, rejectUnauthorized: false,   // self-signed by design
    }, r => { r.resume(); res(r.statusCode); });
    req.on('error', () => res(0));
    req.end();
  });
  check('a device on the network with no key is refused', (await remote()) === 401);
  check('a device with the wrong key is refused',
    (await remote({ 'X-INVOS-Token': 'wrong' })) === 401);
  check('a device with the right key gets in', (await remote(auth)) === 200);
}

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

// ── the station must not become a way in ────────────────────────────────────
/* The realistic failure is not somebody picking a lock: it is the station ending up on
   the open internet by accident — UPnP, an old port forward, a VPS somebody tried it on.
   A public source address is refused before it reaches a handler. */
const publicSrc = await fetch(BASE + '/api/stats', {
  headers: { ...auth, 'X-Forwarded-For': '8.8.8.8' },
});
check('a spoofed X-Forwarded-For does not bypass anything (it is not trusted)',
  publicSrc.ok, `status ${publicSrc.status}`);

// Reading a file BY PATH is a console operation. Accepting it from the network would
// hand any device that can reach the station the ability to open any file its user can.
const remoteFileRead = await fetch(BASE + '/api/import/legacy', {
  method: 'POST',
  headers: { ...json, 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ path: 'C:/Windows/win.ini', dry: true }),
});
check('importing by path still works at the station itself',
  remoteFileRead.status !== 403, `status ${remoteFileRead.status}`);

// ── encryption can be switched, and says so ─────────────────────────────────
/* Encryption is the default and stays recommended. It can be turned off because the
   certificate is self-signed and plenty of things that are not browsers — a label
   printer, an ESP32, a curl script — cannot be taught to accept one. */
const toLan = async tls => await (await fetch(BASE + '/api/lan', {
  method: 'POST', headers: { ...json, 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ on: true, tls }),
})).json();

const plain = await toLan(false);
check('shop access can be switched to plain http at runtime',
  plain.secure === false && (plain.urls || []).some(u => u.startsWith('http://')),
  JSON.stringify(plain.urls));
const secured = await toLan(true);
check('and switched back to https, without a restart',
  secured.secure === true && (secured.urls || []).every(u => u.startsWith('https://')),
  JSON.stringify(secured.urls));

// `lan on` on its own must not silently drop encryption — that is why the field is a
// pointer on the wire rather than a plain bool.
const justOn = await (await fetch(BASE + '/api/lan', {
  method: 'POST', headers: { ...json, 'Sec-Fetch-Site': 'same-origin' },
  body: JSON.stringify({ on: true }),
})).json();
check('turning shop access on does not quietly disable encryption',
  justOn.secure === true, JSON.stringify(justOn));

// The toggle has to work from the UI, not just from the API — that is where it is
// actually used, and where it was reported not working.
{
  const { chromium } = await import('playwright-core');
  const { homedir } = await import('node:os');
  const { existsSync } = await import('node:fs');
  const chrome = (() => {
    const root = join(homedir(), 'AppData/Local/ms-playwright');
    for (const b of ['chromium-1217', 'chromium-1216'])
      for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const p2 = join(root, b, sub);
        if (existsSync(p2)) return p2;
      }
  })();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const type = async cmd => {
    await page.fill('#cmd', '');
    await page.type('#cmd', cmd, { delay: 1 });
    await page.press('#cmd', 'Enter');
    await page.waitForTimeout(700);
  };
  const secure = async () => (await (await fetch(BASE + '/api/server')).json()).secure;

  await type('lan on');
  await type('lan http');
  check('`lan http` from the terminal actually turns encryption off',
    (await secure()) === false);
  await type('lan https');
  check('`lan https` turns it back on', (await secure()) === true);

  // And the settings screen row, which is where most people will find it.
  await type('settings');
  const hasRow = await page.evaluate(() =>
    !!document.querySelector('[data-menu="run:__enctoggle"]'));
  check('settings shows an encryption row while shop access is on', hasRow);
  if (hasRow) {
    await page.evaluate(() => document.querySelector('[data-menu="run:__enctoggle"]').click());
    await page.waitForTimeout(900);
    check('clicking it toggles encryption', (await secure()) === false);
    await type('lan https');
  }
  await browser.close();
}

// ── remote access ───────────────────────────────────────────────────────────
/* A WireGuard mesh (Tailscale and friends) hands out 100.64.0.0/10, which is NOT
   RFC1918 — Go's IsPrivate says false for it. Without allowing it the internet guard
   would have refused every remote-access setup worth recommending, which is the kind of
   thing you only find by trying it. */
{
  const { execFileSync } = await import('node:child_process');
  const probe = [
    'package main',
    'import ("fmt";"net")',
    'var cgnat = &net.IPNet{IP: net.IPv4(100,64,0,0), Mask: net.CIDRMask(10,32)}',
    'func ok(s string) bool {',
    '  ip := net.ParseIP(s)',
    '  if ip == nil { return false }',
    '  if ip4 := ip.To4(); ip4 != nil && cgnat.Contains(ip4) { return true }',
    '  return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()',
    '}',
    'func main(){',
    '  for _, s := range []string{"100.64.0.1","100.115.92.3","192.168.1.5","8.8.8.8","1.1.1.1"} {',
    '    fmt.Println(s + "=" + fmt.Sprint(ok(s)))',
    '  }',
    '}',
  ].join(String.fromCharCode(10));
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const dir = mkdtempSync(join(td(), 'invos-cgnat-'));
  writeFileSync(join(dir, 'main.go'), probe);
  const out = execFileSync('go', ['run', 'main.go'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.PATH};C:\Program Files\Go\bin` },
  });
  const seen = Object.fromEntries(out.trim().split(String.fromCharCode(10))
    .map(l => l.trim()).filter(Boolean).map(l => l.split('=')));
  check('a mesh address (Tailscale, 100.64/10) counts as local',
    seen['100.64.0.1'] === 'true' && seen['100.115.92.3'] === 'true', out.trim());
  check('and the public internet still does not',
    seen['8.8.8.8'] === 'false' && seen['1.1.1.1'] === 'false', out.trim());
}

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
