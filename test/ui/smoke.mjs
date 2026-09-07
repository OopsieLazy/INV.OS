// End-to-end UI test: launches the real invos binary, drives the real terminal UI in a
// headless browser, and checks what a person would actually see on screen.
//
// It exists because the UI is one 3,800-line file with no unit-test seam. The only
// honest way to know a change did not break the terminal is to type into it.
//
//   node smoke.mjs                 # build + run everything
//   node smoke.mjs --headed        # watch it happen
//   node smoke.mjs --keep          # leave the database behind for inspection
//
// Exit code is non-zero if any check fails, so CI can gate on it.

import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PORT = 8211;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const KEEP = process.argv.includes('--keep');

// Playwright's bundled Chromium, located without the full playwright package.
function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const build of ['chromium-1217', 'chromium-1216', 'chromium-1215']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, build, sub);
      if (existsSync(p)) return p;
    }
  }
  return undefined; // fall back to whatever playwright-core can find
}

// ── tiny assertion harness ──────────────────────────────────────────────────
let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

async function main() {
  const dbDir = mkdtempSync(join(tmpdir(), 'invos-ui-'));
  const dbPath = join(dbDir, 'ui.db');

  console.log('building invos…');
  execFileSync('go', ['build', '-o', 'invos-test.exe', './cmd/invos'], {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
  });

  const server = spawn(join(REPO, 'invos-test.exe'),
    ['-db', dbPath, '-port', String(PORT), '-open=false'],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => process.env.VERBOSE && process.stderr.write(d));

  await waitForServer();

  const browser = await chromium.launch({ executablePath: chromePath(), headless: !HEADED });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const t = terminal(page);
    await runChecks(page, t, consoleErrors);
  } finally {
    await browser.close();
    server.kill();
    // Windows keeps the WAL sidecars locked until the process has actually exited,
    // so wait for it rather than racing the unlink.
    await new Promise(r => server.on('exit', r));
    if (!KEEP) {
      try {
        rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch { /* a leftover temp file is not a test failure */ }
    } else {
      console.log(`\ndatabase kept at ${dbPath}`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed: ' + failures.join(', '));
    process.exit(1);
  }
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server never became healthy');
}

// terminal wraps the page as "a person at the prompt".
function terminal(page) {
  return {
    // type without pressing enter — this is what live search reacts to
    async type(text) {
      await page.fill('#cmd', '');
      await page.type('#cmd', text, { delay: 5 });
      await page.waitForTimeout(250);
    },
    // type and execute
    async run(text) {
      await page.fill('#cmd', '');
      await page.type('#cmd', text, { delay: 2 });
      await page.press('#cmd', 'Enter');
      await page.waitForTimeout(350);
    },
    async key(k) {
      await page.press('#cmd', k);
      await page.waitForTimeout(250);
    },
    screen: () => page.textContent('#out'),
    live: () => page.textContent('#live'),
    both: async () => (await page.textContent('#out')) + '\n' + (await page.textContent('#live')),
  };
}

// api reads the server directly, to prove what the UI did actually landed in SQLite
// rather than only in the browser.
const api = {
  async get(path) {
    const r = await fetch(BASE + path);
    return r.json();
  },
};

async function runChecks(page, t, consoleErrors) {
  console.log('\nfirst run');

  // A brand new database has never been set up, so the welcome doors come first.
  const welcome = await t.screen();
  check('a fresh database opens on the welcome doors',
    /Welcome/i.test(welcome) && /just start/i.test(welcome), welcome.slice(0, 240));

  // Take the demo door: it seeds items AND connected projects in one go.
  await t.run('__fr_demo');
  await page.waitForTimeout(600);
  const demoItems = await api.get('/api/stats');
  check('the demo door seeded the database', demoItems.items >= 10,
    `server reports ${demoItems.items} items`);

  const demoProjects = await api.get('/api/projects');
  check('the demo door created projects', demoProjects.length === 4,
    `server reports ${demoProjects.length} projects`);

  const bridges = await api.get('/api/shared-parts');
  check('demo projects share parts (the galaxy bridges)', bridges.length > 0,
    `${bridges.length} shared parts`);

  console.log('\nterminal');

  await t.key('Escape');
  const home = await t.screen();
  check('home screen lists the ten departments',
    /ELECTRICAL/.test(home) && /TOOLS/.test(home), home.slice(0, 200));
  check('home screen shows a totals line', /components/.test(home), home.slice(0, 200));

  // add
  await t.run('add test widget x7 @1110');
  const afterAdd = await t.both();
  check('add reports the new item', /widget/i.test(afterAdd), afterAdd.slice(-300));

  // live search reacts without pressing enter
  await t.type('widget');
  const live = await t.live();
  check('live search finds it while typing', /widget/i.test(live), live.slice(0, 300));

  // unicode-tolerant search, the behavior the shop relies on
  await page.fill('#cmd', '');
  await t.run('add Resistor 10kΩ x50 @1111');
  await t.type('10kohm');
  const uni = await t.live();
  check('typing 10kohm finds 10kΩ', /10k/i.test(uni), uni.slice(0, 300));

  // stock movement
  await page.fill('#cmd', '');
  await t.run('take widget 3');
  const afterTake = await t.both();
  check('take reports the new count', /4|widget/i.test(afterTake), afterTake.slice(-250));

  // shelf navigation by bin digit
  await t.run('1');
  const shelf = await t.screen();
  check('typing a digit opens that department', /ELECTRICAL|BIN|11/i.test(shelf), shelf.slice(0, 250));

  // low stock report
  await t.run('low');
  check('low command runs', typeof (await t.screen()) === 'string');

  // undo
  await t.run('undo');
  const afterUndo = await t.both();
  check('undo runs and reports', /undo|undone|restored|took|reversed/i.test(afterUndo),
    afterUndo.slice(-250));

  // help
  await t.run('help');
  const help = await t.screen();
  check('help lists commands', /add/i.test(help) && /take/i.test(help), help.slice(0, 200));

  await t.key('Escape');
  check('escape returns home', /components|Sections/i.test(await t.screen()));

  check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join('; '));

  // ── does what the UI did actually reach the database? ────────────────────
  console.log('\npersistence (server-side truth)');
  const stats = await api.get('/api/stats');
  check('server has a non-empty database', stats.items > 0,
    `server reports ${stats.items} items`);

  const found = await api.get('/api/items?q=widget');
  check('the item typed into the UI exists server-side', found.total > 0,
    `GET /api/items?q=widget -> total ${found.total}`);

  const widget = found.rows[0];
  // 7 added, 3 taken, then the `undo` above reversed that take — so 7 is the
  // correct figure, and it proves the undo reached the database rather than only
  // the screen.
  check('quantity in the database reflects add, take and undo',
    widget && widget.qty === 7, `qty is ${widget && widget.qty}, expected 7`);
  check('add filed it in the typed bin',
    widget && widget.bin === 1110, `bin is ${widget && widget.bin}`);

  // move, driven through the UI, verified in the database
  await t.run(`move ${cid(widget)} 1150`);
  const moved = await api.get(`/api/items/${widget.cid}`);
  check('move updated the bin server-side', moved.bin === 1150, `bin is ${moved.bin}`);

  // delete + undo must bring back the SAME permanent id — the printed-label promise
  await t.run(`del ${cid(widget)}`);
  await t.run('y');
  const goneRes = await fetch(`${BASE}/api/items/${widget.cid}`);
  check('delete removed it from the database', goneRes.status === 404,
    `GET returned ${goneRes.status}`);

  await t.run('undo');
  const restored = await fetch(`${BASE}/api/items/${widget.cid}`);
  check('undo restored it with its original C-ID', restored.status === 200,
    `GET returned ${restored.status}`);

  // the activity log is the audit trail the product sells on
  const log = await api.get('/api/log?limit=50');
  check('every action was written to the activity log', log.total >= 5,
    `log holds ${log.total} entries`);

  // ── projects and BOM, driven from the terminal, checked in the database ───
  console.log('\nprojects');

  await t.run('proj new TestRig');
  const projs = await api.get('/api/projects');
  const rig = projs.find(p => p.name === 'TestRig');
  check('proj new created a project server-side', !!rig,
    `server has ${projs.map(p => p.name).join(', ')}`);
  check('a new project becomes the active one', rig && rig.active);

  await t.run('proj add TestRig 3x Breadboard');
  const bom = await api.get(`/api/projects/${rig.pid}/bom`);
  check('proj add wrote a BOM line', bom.length === 1 && bom[0].need === 3,
    JSON.stringify(bom));
  check('the BOM line reports live stock', bom.length === 1 && bom[0].have > 0,
    JSON.stringify(bom));

  await t.run('undo');
  const bomAfterUndo = await api.get(`/api/projects/${rig.pid}/bom`);
  check('undo removed the BOM line', bomAfterUndo.length === 0,
    JSON.stringify(bomAfterUndo));

  await t.run('proj del TestRig');
  const projsAfter = await api.get('/api/projects');
  check('proj del removed it', !projsAfter.some(p => p.name === 'TestRig'),
    projsAfter.map(p => p.name).join(', '));

  // ── orbit mode: the galaxy has to actually move ───────────────────────────
  console.log(String.fromCharCode(10) + 'orbit mode');

  await t.run('graph galaxy');
  await t.run('graph orbit');
  // Orbits are captured once the force layout settles, and how long that takes
  // depends on the machine — so wait for the condition, not for a guessed duration.
  let settled = true;
  try {
    await page.waitForFunction(() => typeof gOrbitInit !== 'undefined' && gOrbitInit,
      null, { timeout: 8000 });
  } catch { settled = false; }

  const sample = () => page.evaluate(() =>
    gNodes.filter(n => n.type !== 'sun').slice(0, 12).map(n => [n.x, n.y, n.z]));

  const drifted = (a, b) => a.some((p, i) =>
    Math.abs(p[0] - b[i][0]) > 0.01 || Math.abs(p[1] - b[i][1]) > 0.01 ||
    Math.abs(p[2] - b[i][2]) > 0.01);

  const orbitOn = await page.evaluate(() => gOrbit);
  check('graph orbit turns the mode on', orbitOn === true);
  check('orbits were captured once the layout settled', settled,
    'gOrbitInit never became true within 8s');

  const a1 = await sample();
  await page.waitForTimeout(500);
  const a2 = await sample();
  check('nodes revolve while orbit mode is on', drifted(a1, a2),
    `first node ${JSON.stringify(a1[0])} -> ${JSON.stringify(a2[0])}`);

  // every orbiting node must keep a fixed distance from its parent — that is what
  // makes it an orbit rather than the force simulation drifting
  check('each node holds its orbital radius', await page.evaluate(() => {
    const byId = {}; gNodes.forEach(n => byId[n.id] = n);
    return gNodes.every(n => {
      if (!n.orb) return true;
      const par = byId[n.orb.parent]; if (!par) return true;
      const r = Math.hypot(n.x - par.x, n.y - par.y, (n.z || 0) - (par.z || 0));
      return Math.abs(r - n.orb.r) < 0.5;
    });
  }));

  await t.run('graph orbit');
  check('graph orbit turns the mode off again',
    (await page.evaluate(() => gOrbit)) === false);

  await t.run('graph inv');
  check('the inventory view is left alone by orbit mode',
    await page.evaluate(() => gNodes.every(n => n.type !== 'proj')));
  await t.key('Escape');

  // ── every previously-gated feature now writes to the database ─────────────
  console.log(String.fromCharCode(10) + 'ported features');

  // cycle count: walk one item, correct it, check the correction and the history
  const target = (await api.get('/api/items?q=breadboard')).rows[0];
  await t.run(`count 9`);
  const counting = await t.screen();
  check('count walks a scope', /CYCLE COUNT/i.test(counting), counting.slice(-200));
  await t.run('99');                                   // correct the first item to 99
  await t.run('stop');
  const counted = (await api.get('/api/items?q=breadboard')).rows[0];
  check('a count writes the corrected quantity to the database',
    counted.qty === 99 || counted.counted, `qty ${counted.qty}, counted ${counted.counted}`);
  const clog = await api.get('/api/countlog');
  check('the count is recorded in the count history', clog.length >= 1,
    `${clog.length} entries`);
  await t.run('count report');
  check('count report renders the history', /COUNT HISTORY/i.test(await t.screen()));

  // doctor + tidy read the whole inventory
  await t.run('doctor');
  const doc = await t.screen();
  check('doctor runs over the whole inventory',
    /DOCTOR REPORT|database clean/i.test(doc), doc.slice(-200));
  await t.run('tidy');
  check('tidy runs', /tidy|consistent/i.test(await t.screen()));

  // merge folds one item into another, in the database
  await fetch(`${BASE}/api/items`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Merge Alpha', bin: 3110, qty: 5 }) });
  await fetch(`${BASE}/api/items`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Merge Beta', bin: 3111, qty: 7 }) });
  const ma = (await api.get('/api/items?q=Merge Alpha')).rows[0];
  const mb = (await api.get('/api/items?q=Merge Beta')).rows[0];
  await t.run(`merge ${cid(ma)} ${cid(mb)}`);
  const kept = await api.get(`/api/items/${ma.cid}`);
  const goneRes2 = await fetch(`${BASE}/api/items/${mb.cid}`);
  check('merge adds the quantities together', kept.qty === 12, `qty ${kept.qty}`);
  check('merge removes the duplicate', goneRes2.status === 404, `status ${goneRes2.status}`);
  await t.run('undo');
  check('undo restores the merged-away item',
    (await fetch(`${BASE}/api/items/${mb.cid}`)).status === 200);

  // remap moves a whole range of bins in one bulk write
  await t.run('remap 311 411');
  const remapped = await api.get(`/api/items/${ma.cid}`);
  check('remap rewrote the bin server-side', String(remapped.bin).startsWith('411'),
    `bin ${remapped.bin}`);
  await t.run('undo');
  check('undo reverses the whole remap in one step',
    (await api.get(`/api/items/${ma.cid}`)).bin === 3110);

  // photos live in the database, so any device sees them
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.evaluate(async ([c, d]) => { await DB.putPhoto(c, d); },
    [ma.cid, png]);
  const ids = await api.get('/api/photos');
  check('a photo is stored in the database', ids.includes(ma.cid), JSON.stringify(ids));
  const shot = await fetch(`${BASE}/api/items/${ma.cid}/photo`);
  check('the photo is served back', shot.ok && shot.headers.get('content-type') === 'image/png',
    `status ${shot.status}`);

  // backup + the real database file
  const dump = await api.get('/api/export');
  check('backup exports the whole shop', Array.isArray(dump.items) && dump.items.length > 0
    && Array.isArray(dump.projects), `items ${dump.items && dump.items.length}`);
  const dbFile = await fetch(`${BASE}/api/db`);
  const dbBuf = await dbFile.arrayBuffer();
  const magic = new TextDecoder().decode(new Uint8Array(dbBuf).slice(0, 15));
  check('db export returns a real SQLite file', magic === 'SQLite format 3',
    `header was ${JSON.stringify(magic)}`);

  await t.run('server');
  check('server screen reports this station', /SERVER/i.test(await t.screen()));
  await t.run('db');
  check('db screen shows the live file', /DATABASE/i.test(await t.screen()));
  await t.run('rollback');
  check('rollback lists reversible steps', /ROLLBACK/i.test(await t.screen()));
  await t.key('Escape');

  // ── galaxy and orbit are settings, not forks ──────────────────────────────
  // The repo used to carry a whole second copy of the app with the galaxy removed.
  // These checks are what let that fork be deleted: one setting has to neutralise
  // every entry point (command, view cycle, menu).
  console.log(String.fromCharCode(10) + 'toggles');

  await t.run('set galaxy 0');
  check('galaxy can be switched off', (await page.evaluate(() => cfg('galaxy'))) === 0);

  await t.run('graph galaxy');
  check('graph galaxy falls back to projects when off',
    (await page.evaluate(() => gView.kind)) === 'projects',
    'view is ' + (await page.evaluate(() => gView.kind)));

  check('the view cycle skips galaxy when off', await page.evaluate(() => {
    const seen = new Set();
    for (let i = 0; i < 6; i++) { cycleView(); seen.add(gView.kind); }
    return !seen.has('galaxy');
  }));

  await t.run('menu');
  check('the galaxy entry is hidden from the command menu',
    !/projects as a 3D galaxy/i.test(await t.screen()));

  await t.run('set galaxy 1');
  await t.run('graph galaxy');
  check('galaxy comes back when switched on',
    (await page.evaluate(() => gView.kind)) === 'galaxy');
  await t.run('menu');
  check('the galaxy entry returns to the menu',
    /projects as a 3D galaxy/i.test(await t.screen()));

  // orbit is remembered, so it is a deliberate choice rather than a per-session accident
  await t.run('graph orbit');
  check('graph orbit records the setting', (await page.evaluate(() => cfg('orbit'))) === 1);
  await t.run('graph orbit');
  check('turning orbit off records that too',
    (await page.evaluate(() => cfg('orbit'))) === 0);
  await t.key('Escape');

  // ── every command runs without throwing ───────────────────────────────────
  // Parity sweep: the exe must not have a command that blows up where the HTML build
  // worked. This does not check what each one DOES — the checks above do that — it
  // catches the class of breakage a port introduces: a function that now needs an
  // await, or reads a field the server names differently.
  console.log(String.fromCharCode(10) + 'command sweep');
  const errorsBefore = consoleErrors.length;
  const sweep = [
    'help', 'keys', 'menu', 'stats', 'health', 'low', 'list', 'bins', 'map', 'classes',
    'sections', 'recent', 'log', 'demo', 'settings', 'theme', 'server', 'db', 'rollback',
    'count report', 'doctor', 'tidy', 'proj', 'template', 'setup', 'welcome',
    'graph', 'graph inv', 'graph projects', 'graph galaxy', 'graph 2d', 'graph 3d',
    'graph home', 'graph png', 'labels 1', 'info breadboard', 'find resistor', '1', '11',
  ];
  for (const cmdText of sweep) {
    await t.run(cmdText);
    if (cmdText === 'setup' || cmdText === 'welcome') await t.key('Escape');
  }
  await t.key('Escape');
  const newErrors = consoleErrors.slice(errorsBefore);
  check('every command runs without a page error', newErrors.length === 0,
    newErrors.slice(0, 3).join(' | '));

  // ── stale-data guard ──────────────────────────────────────────────────────
  // The service worker caches the app shell. It must NOT cache /api/, or the same
  // GET returns yesterday's inventory forever — a bin that reads 40 when the drawer
  // holds 4. This repeats one identical request across a change and demands the
  // second answer differ.
  console.log('\nstale data');
  const before = await page.evaluate(() => fetch('/api/stats').then(r => r.json()));
  await fetch(`${BASE}/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cache Canary', bin: 9910, qty: 1 }),
  });
  const after = await page.evaluate(() => fetch('/api/stats').then(r => r.json()));
  check('an identical API request is not served from a stale cache',
    after.items === before.items + 1,
    `items went ${before.items} -> ${after.items}; the service worker must skip /api/`);

  // ── the reason the exe exists: two devices, one inventory ─────────────────
  console.log('\nmulti-device (one database, two browsers)');
  const second = await page.context().browser().newPage();
  try {
    await second.goto(BASE, { waitUntil: 'networkidle' });
    const t2 = terminal(second);
    await t2.run('add shared bench grinder x2 @9110');
    await second.waitForTimeout(200);

    // the FIRST browser must see it with no sync step of any kind
    await t.type('grinder');
    const seen = await t.live();
    check('an item added on one device appears on the other', /grinder/i.test(seen),
      seen.slice(0, 200));

    const g = await api.get('/api/items?q=grinder');
    check('both devices are reading one database', g.total === 1,
      `server holds ${g.total} matching rows`);
  } finally {
    await second.close();
  }
}

// cid renders an item's permanent short id the way the terminal accepts it.
function cid(item) {
  return 'C-' + String(item.cid).padStart(3, '0');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
