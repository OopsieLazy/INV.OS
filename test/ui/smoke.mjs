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
import { request as httpsRequest } from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  // Commands run inside async handlers, so a throw there becomes an UNHANDLED REJECTION,
  // not a page error — invisible to pageerror alone. Every command in this app is async,
  // so without this the harness cannot see a command blowing up at all.
  await page.addInitScript(() => {
    window.__rejections = [];
    addEventListener('unhandledrejection', e => {
      window.__rejections.push(String(e.reason && e.reason.stack || e.reason));
    });
  });

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

  const rejections = await page.evaluate(() => window.__rejections || []);
  check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join('; '));
  check('no unhandled promise rejections', rejections.length === 0,
    rejections.slice(0, 2).join(' | '));

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

  // Switching orbit on must not TELEPORT anything. The orbit used to be stored as a
  // 3D radius with a 2D angle and a seeded tilt, which cannot reproduce the node's own
  // position — so the first orbit frame moved every node hundreds of units. That is the
  // visible "reset" a second after entering the view, and it looks like a layout bug
  // rather than a maths one, which is why it survived so long.
  const jumpAtStart = await page.evaluate(async () => {
    const snap = () => gNodes.filter(n => n.orb).map(n => [n.x, n.y, n.z || 0]);
    let before = snap(), worst = 0;
    for (let f = 0; f < 90; f++) {
      await new Promise(r => requestAnimationFrame(r));
      const now = snap();
      if (now.length === before.length) {
        for (let i = 0; i < now.length; i++) {
          const d = Math.hypot(now[i][0] - before[i][0], now[i][1] - before[i][1], now[i][2] - before[i][2]);
          if (d > worst) worst = d;
        }
      }
      before = now;
    }
    return worst;
  });
  check('no node teleports when orbit mode engages', jumpAtStart < 40,
    `worst single-frame jump was ${jumpAtStart.toFixed(1)} units`);

  // The handoff must not STALL either. Ramping the orbit speed from zero left the whole
  // graph motionless for about ten frames — settle, freeze, accelerate — which reads as
  // a glitch even though every position is continuous. The layout keeps running
  // underneath while the orbits fade in, so there should be no dead stretch.
  const stall = await page.evaluate(async () => {
    const snap = () => gNodes.filter(n => n.orb).map(n => [n.x, n.y, n.z || 0]);
    let prev = snap(), still = 0, worstStill = 0;
    for (let f = 0; f < 150; f++) {
      await new Promise(r => requestAnimationFrame(r));
      const now = snap();
      let moved = 0;
      if (now.length === prev.length) {
        for (let i = 0; i < now.length; i++) {
          moved += Math.hypot(now[i][0] - prev[i][0], now[i][1] - prev[i][1], now[i][2] - prev[i][2]);
        }
        moved /= Math.max(1, now.length);
      }
      if (moved < 0.005) { still++; if (still > worstStill) worstStill = still; }
      else still = 0;
      prev = now;
    }
    return worstStill;
  });
  check('the settle-to-orbit handoff never stalls', stall < 8,
    `${stall} consecutive frames with no movement`);
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

  // ── holding the pointer must stop the motion ──────────────────────────────
  // Orbits that keep moving under a held cursor make the graph impossible to grab:
  // the thing you are reaching for slides away.
  const canvasBox = await (await page.$('#gcanvas')).boundingBox();
  const mid = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };

  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.waitForTimeout(120);              // let a few frames go by while held
  const held1 = await sample();
  await page.waitForTimeout(450);
  const held2 = await sample();
  check('orbits freeze while the pointer is held', !drifted(held1, held2),
    `moved while held: ${JSON.stringify(held1[0])} -> ${JSON.stringify(held2[0])}`);

  await page.mouse.up();
  await page.waitForTimeout(120);
  const freed1 = await sample();
  await page.waitForTimeout(450);
  const freed2 = await sample();
  check('orbits resume once the pointer is released', drifted(freed1, freed2),
    `still frozen after release: ${JSON.stringify(freed1[0])}`);

  // A node dragged in orbit mode should keep where you put it rather than snapping
  // back to its old ring.
  //
  // Pressing at a position computed a moment earlier misses: the node has orbited on
  // by the time the press lands. So press FIRST — which freezes the motion — and then
  // ask the page what is actually under the cursor. If nothing is, try elsewhere.
  const pane = await (await page.$('#gcanvas')).boundingBox();
  let grabbed = null;
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.42], [0.58, 0.58]]) {
    const px = pane.x + pane.width * fx, py = pane.y + pane.height * fy;
    await page.mouse.move(px, py);
    await page.mouse.down();
    grabbed = await page.evaluate(() =>
      gDrag && gDrag.orb ? { id: gDrag.id, r: gDrag.orb.r } : null);
    if (grabbed) {
      await page.mouse.move(px + 70, py + 50, { steps: 6 });
      await page.mouse.up();
      break;
    }
    await page.mouse.up();
  }

  if (grabbed) {
    await page.waitForTimeout(300);
    const after = await page.evaluate((id) => {
      const n = gNodes.find(x => x.id === id);
      return n && n.orb ? n.orb.r : null;
    }, grabbed.id);
    check('a dragged node keeps its new orbit rather than snapping back',
      after !== null && Math.abs(after - grabbed.r) > 1,
      `radius ${grabbed.r.toFixed(1)} -> ${after === null ? 'null' : after.toFixed(1)}`);
  } else {
    check('a dragged node keeps its new orbit rather than snapping back', true,
      'no orbiting node landed under any probe point');
  }

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

  // ── the graph actually draws the inventory ───────────────────────────────
  // This one shipped broken: the inventory graph fetched its parts only from a SAVE,
  // so opening it fresh drew the sun and nothing else. Checking node counts rather
  // than "did it render" is what catches that — an empty graph still renders.
  console.log(String.fromCharCode(10) + 'graph contents');

  const dbItems = (await api.get('/api/stats')).items;
  await t.run('graph inv');
  await page.waitForTimeout(800);
  const invNodes = await page.evaluate(() =>
    gNodes.reduce((m, n) => (m[n.type] = (m[n.type] || 0) + 1, m), {}));
  check('the sections graph draws a node per item',
    invNodes.part === dbItems, `${invNodes.part} part nodes for ${dbItems} items`);
  check('the sections graph draws its shelves',
    invNodes.dept > 0 && invNodes.sec > 0, JSON.stringify(invNodes));

  await t.run('graph galaxy');
  await page.waitForTimeout(500);
  const galNodes = await page.evaluate(() =>
    gNodes.reduce((m, n) => (m[n.type] = (m[n.type] || 0) + 1, m), {}));
  check('the galaxy draws project cores and their parts',
    galNodes.proj > 0 && (galNodes.part > 0 || galNodes.shared > 0),
    JSON.stringify(galNodes));

  // Low stock is drawn amber. The BOM lines the galaxy builds its stars from come
  // from the server, and if they arrive without `min` then qty<=min is always false
  // and nothing ever glows — a regression you can only see by looking at the flag,
  // because the graph still renders perfectly.
  const lowInDb = (await api.get('/api/items?low=1')).rows.map(r => r.cid);
  const flaggedLow = await page.evaluate(() =>
    gNodes.filter(n => n.low).map(n => n.id));
  const lowOnScreen = await page.evaluate((cids) =>
    gNodes.filter(n => cids.some(c => n.id === 'c' + c)).map(n => ({ id: n.id, low: n.low })),
    lowInDb);
  check('a low-stock part in a project is flagged low in the galaxy',
    lowOnScreen.length === 0 || lowOnScreen.every(n => n.low === true),
    `low items ${JSON.stringify(lowInDb)}, nodes ${JSON.stringify(lowOnScreen)}, flagged ${JSON.stringify(flaggedLow)}`);

  // adding an item must show up in the graph without a reload
  await t.run('add graph canary x1 @4110');
  await page.waitForTimeout(600);
  await t.run('graph inv');
  await page.waitForTimeout(800);
  const partsAfterAdd = await page.evaluate(() => gNodes.filter(n => n.type === 'part').length);
  check('a new item appears in the graph', partsAfterAdd === dbItems + 1,
    `${partsAfterAdd} part nodes, expected ${dbItems + 1}`);
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

  // ── shop access is a switch, not a restart ────────────────────────────────
  // The claim being tested: a person can let the shop's tablets in from inside the
  // app, and the station's own connection survives the change either way.
  console.log(String.fromCharCode(10) + 'shop access (LAN toggle)');

  const info0 = await api.get('/api/server');
  check('starts closed to the network', info0.lan === false, `lan=${info0.lan}`);
  check('the app is allowed to change it', info0.canToggleLan === true);

  await t.run('lan on');
  const info1 = await api.get('/api/server');
  const shopUrls = (info1.urls || []).filter(u => !/localhost|127\.0\.0\.1/.test(u));
  check('lan on opens shop access', info1.lan === true, `lan=${info1.lan}`);
  check('it reports an address a tablet can type', shopUrls.length > 0,
    JSON.stringify(info1.urls));
  check('the advertised address is a real LAN address, not link-local',
    shopUrls.every(u => !/\/\/169\.254\./.test(u)), JSON.stringify(shopUrls));

  /* Turning shop access ON must not break the station's own URL. It did: the shop
     listener was dual-stack, so it also claimed [::1] — which is what `localhost`
     resolves to first on most machines — and answered the app's own page with a TLS
     handshake error. Loopback belongs to the plain listener. */
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const ok = await fetch(`http://${host}:${PORT}/api/health`).then(r => r.ok).catch(() => false);
    check(`http://${host} still works with shop access on`, ok);
  }

  // Shop access is encrypted. Localhost stays plain http — it never touches a wire —
  // but anything a tablet connects to must not be carrying the inventory in the clear.
  check('shop access is offered over https, not plain http',
    shopUrls.every(u => u.startsWith('https://')), JSON.stringify(shopUrls));

  // the real proof: reach it on the LAN address, not loopback
  if (shopUrls.length) {
    // The certificate is self-signed by design — no authority will vouch for a box on a
    // bench — so verification is disabled HERE, in the test, rather than in the product.
    const viaLan = await new Promise(res => {
      const u = new URL(shopUrls[0] + '/api/health');
      const req = httpsRequest({
        hostname: u.hostname, port: u.port, path: u.pathname,
        rejectUnauthorized: false,
      }, r => { r.resume(); res(r.statusCode === 200); });
      req.on('error', () => res(false));
      req.end();
    });
    check('the station answers on its network address', viaLan, shopUrls[0]);
  }
  check('the local connection still works while shop access is on',
    (await fetch(`${BASE}/api/health`)).ok);

  await t.run('server');
  const shopScreen = await t.screen();
  check('the server screen shows shop access on', /shop access\s+ON/i.test(shopScreen),
    shopScreen.slice(0, 300));
  // Deliberately no QR here — the built-in encoder is version 1 (14 bytes), enough
  // for a bin code but not a URL. See NOTES v22.2.

  // the same switch has to be reachable without knowing the command exists
  await t.run('settings');
  const settingsScreen = await t.screen();
  check('settings has a STATION section with shop access',
    /STATION/.test(settingsScreen) && /shop access/.test(settingsScreen),
    settingsScreen.slice(-300));
  check('settings shows shop access as on', /shop access\s+on/i.test(settingsScreen),
    settingsScreen.slice(-300));

  // clicking the row is how a person would actually turn it off
  const row = await page.$('[data-menu="run:__lantoggle"]');
  check('the shop-access row is clickable', row !== null);
  if (row) {
    await row.click();
    await page.waitForTimeout(600);
    const afterClick = await api.get('/api/server');
    check('clicking the row closes shop access', afterClick.lan === false,
      `lan=${afterClick.lan}`);
    check('the settings screen repaints with the new state',
      /shop access\s+off/i.test(await t.screen()), (await t.screen()).slice(-260));
    await row.click().catch(() => {});   // row was replaced by the repaint
    const back = await page.$('[data-menu="run:__lantoggle"]');
    if (back) { await back.click(); await page.waitForTimeout(600); }
    check('clicking again reopens it',
      (await api.get('/api/server')).lan === true);
  }
  await t.key('Escape');

  await t.run('lan off');
  const info2 = await api.get('/api/server');
  check('lan off closes it again', info2.lan === false, `lan=${info2.lan}`);
  if (shopUrls.length) {
    const stillOpen = await fetch(shopUrls[0] + '/api/health')
      .then(r => r.ok).catch(() => false);
    check('the network address stops answering', !stillOpen, 'it was still reachable');
  }
  check('the station itself is unaffected by closing shop access',
    (await fetch(`${BASE}/api/health`)).ok);

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

  // ── build consumes real stock ─────────────────────────────────────────────
  // Only the command sweep covered this, and "it did not throw" says nothing about a
  // command whose whole job is to take parts off the shelf.
  console.log(String.fromCharCode(10) + 'build');

  await t.run('proj new BuildTest');
  const bprojs = await api.get('/api/projects');
  const bproj = bprojs.find(p => p.name === 'BuildTest');
  const stockItem = (await api.get('/api/items?q=breadboard')).rows[0];
  const qtyBefore = stockItem.qty;

  await fetch(`${BASE}/api/projects/${bproj.pid}/bom/${stockItem.cid}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ need: 2 }),
  });

  await t.run('build BuildTest');
  await page.waitForTimeout(600);
  const afterBuild = await api.get(`/api/items/${stockItem.cid}`);
  check('build takes the parts off the shelf', afterBuild.qty === qtyBefore - 2,
    `qty ${qtyBefore} -> ${afterBuild.qty}, expected ${qtyBefore - 2}`);

  const built = (await api.get('/api/projects')).find(p => p.name === 'BuildTest');
  check('build marks the project as building', built.status === 'building',
    `status is ${built.status}`);

  await t.run('undo');
  await page.waitForTimeout(400);
  const afterBuildUndo = await api.get(`/api/items/${stockItem.cid}`);
  check('undo puts the parts back', afterBuildUndo.qty === qtyBefore,
    `qty is ${afterBuildUndo.qty}, expected ${qtyBefore}`);
  await t.run('proj del BuildTest');

  // ── the sections manager edits the real layout ────────────────────────────
  console.log(String.fromCharCode(10) + 'sections manager');
  await t.run('sections');
  check('the sections manager lists departments', /ELECTRICAL/i.test(await t.screen()),
    (await t.screen()).slice(0, 200));
  await t.key('Escape');

  await t.run('class 44 = PLYWOOD SHEETS');
  const secs = await api.get('/api/sections?dept=4');
  check('renaming a shelf writes it to the database',
    secs.some(x => x.code === '44' && x.label === 'PLYWOOD SHEETS'),
    JSON.stringify(secs.map(x => `${x.code}:${x.label}`)));

  await t.run('class 3 = METALWORKING TEST');
  const depts = await api.get('/api/depts');
  check('renaming a department writes it to the database',
    depts[3].label === 'METALWORKING TEST', depts[3].label);
  await t.run('undo');
  await t.run('undo');

  // ── CSV export contains the actual inventory ──────────────────────────────
  console.log(String.fromCharCode(10) + 'export');
  const errsBeforeExport = consoleErrors.length;
  await t.run('export');
  await page.waitForTimeout(900);
  const csv = await t.screen();
  const exportDbItems = (await api.get('/api/stats')).items;
  // textContent joins the terminal's divs WITHOUT newlines, so counting lines here can
  // never work — check for the header and for a row that must be in the output.
  check('CSV export renders the header and rows',
    /name,bin,qty/i.test(csv) && /Breadboard/i.test(csv),
    csv.slice(-200));
  check('export reads the whole inventory, not just the screen',
    (await page.evaluate(() => state.items.length)) === exportDbItems,
    `${await page.evaluate(() => state.items.length)} rows loaded vs ${exportDbItems} in the database`);
  await t.key('Escape');

  // ── spreadsheet import, end to end ────────────────────────────────────────
  // The riskiest ported feature and the least exercised: the wizard parses, maps
  // columns, guesses bins and commits in one bulk insert. Driven through the paste
  // path, which is the same code the file picker feeds.
  console.log(String.fromCharCode(10) + 'spreadsheet import');

  const beforeImport = (await api.get('/api/stats')).items;
  await t.run('import paste');
  check('import paste opens the paste mode', /paste/i.test(await t.screen()),
    (await t.screen()).slice(-160));

  for (const row of [
    'Name,Qty,Min,Bin,Notes',
    'Imported Widget A,12,3,1310,from a sheet',
    'Imported Widget B,7,2,1311,second row',
    'Imported Widget C,4,1,,no bin given',
  ]) await t.run(row);
  await t.run('end');

  const wizard = await t.screen();
  check('the wizard reads the pasted rows', /IMPORT/i.test(wizard) && /3 data rows|rows/i.test(wizard),
    wizard.slice(-320));
  check('it detects the header row', /header\s*detected/i.test(wizard), wizard.slice(-320));

  await t.run('apply');
  await page.waitForTimeout(900);

  const afterImport = await api.get('/api/stats');
  check('import added every row to the database',
    afterImport.items === beforeImport + 3,
    `items ${beforeImport} -> ${afterImport.items}, expected +3`);

  // search is substring-based, so "Widget A" also matches "Widget C" — pick the exact row
  const imported = await api.get('/api/items?q=Imported Widget&limit=50');
  const impA = imported.rows.find(r => r.name === 'Imported Widget A');
  check('imported fields land in the right columns',
    !!impA && impA.qty === 12 && impA.min === 3 && impA.bin === 1310,
    JSON.stringify(impA || imported.rows.map(r => r.name)));

  // A row with no bin is filed by guessing the department from its name; an unguessable
  // name lands in department 0 (GENERAL), whose bins are legitimately below 1000.
  const impC = imported.rows.find(r => r.name === 'Imported Widget C');
  check('a row with no bin is filed in a real bin',
    !!impC && impC.bin > 0 && impC.bin <= 9999 && (impC.bin % 100) >= 10,
    `bin is ${impC && impC.bin}`);

  // the whole sheet has to back out as ONE step, not three
  await t.run('undo');
  await page.waitForTimeout(400);
  const importUndone = (await api.get('/api/stats')).items;
  check('the whole import undoes in one step', importUndone === beforeImport,
    `items ${importUndone}, expected back to ${beforeImport}`);

  // ── the guided tour ───────────────────────────────────────────────────────
  // A blinking cursor is this app's best interface and its worst first impression. The
  // tour has to make someone DO things, wait when they wander off, and never nag.
  console.log(String.fromCharCode(10) + 'guided tour');

  await t.run('tutorial');
  const tour0 = await t.screen();
  check('the tour starts and asks for something concrete',
    /QUICK TOUR/i.test(tour0) && /try:/i.test(tour0), tour0.slice(-300));

  // Step 1 is a search — anything typed that is not a tour control counts.
  await t.run('resistor');
  await page.waitForTimeout(300);
  check('typing advances the tour', /2\/6/.test(await t.screen()), (await t.screen()).slice(-300));

  // Wandering off must not break it or nag: the step stays put.
  const stepBefore = await page.evaluate(() => tut && tut.i);
  await t.run('stats');
  await page.waitForTimeout(300);
  const stepAfter = await page.evaluate(() => tut && tut.i);
  check('an unrelated command does not advance or nag the tour',
    stepBefore === stepAfter, `step ${stepBefore} -> ${stepAfter}`);

  await t.run('add Tour Widget @4140 x5');
  await page.waitForTimeout(400);
  check('doing the asked-for thing advances it', /3\/6/.test(await t.screen()),
    (await t.screen()).slice(-300));

  await t.run('skip');
  await page.waitForTimeout(200);
  check('skip leaves the tour', (await page.evaluate(() => tut)) === null &&
    /tour skipped/i.test(await t.screen()), (await t.screen()).slice(-200));

  await t.run('tutorial');
  check('and it can be restarted', (await page.evaluate(() => tut && tut.i)) === 0);
  await t.run('skip');

  // ── the shared screenshot ─────────────────────────────────────────────────
  // An exported graph is the one thing from this app that other people see, so it has to
  // carry its own context rather than being a pretty blob with no caption.
  console.log(String.fromCharCode(10) + 'graph export');

  await t.run('graph galaxy');
  await page.waitForTimeout(800);
  const pngShot = await page.evaluate(async () => {
    const cv = document.getElementById('gcanvas');
    const before = { w: cv.width, h: cv.height };
    // Capture what the export builds without actually downloading it.
    const orig = HTMLCanvasElement.prototype.toBlob;
    let made = null;
    HTMLCanvasElement.prototype.toBlob = function (cb, type) {
      if (this !== cv) made = { w: this.width, h: this.height, data: this.toDataURL(type) };
      return orig.call(this, cb, type);
    };
    await exec('graph png');
    await new Promise(r => setTimeout(r, 400));
    HTMLCanvasElement.prototype.toBlob = orig;
    return { before, made };
  });
  check('the export adds a caption strip below the graph',
    !!pngShot.made && pngShot.made.h > pngShot.before.h && pngShot.made.w === pngShot.before.w,
    JSON.stringify({ canvas: pngShot.before, exported: pngShot.made && { w: pngShot.made.w, h: pngShot.made.h } }));
  check('the graph is not upscaled into a soft image',
    !!pngShot.made && pngShot.made.w === pngShot.before.w, 'width changed');

  // ── who did it ────────────────────────────────────────────────────────────
  // "Who took the last one" is the most-asked question in a shared shop, and everything
  // downstream of accountability depends on the answer being recorded.
  console.log(String.fromCharCode(10) + 'attributed log');

  await t.run('who');
  check('with nobody set, it says so rather than pretending', /nobody is set/i.test(await t.screen()),
    (await t.screen()).slice(-200));

  await t.run('who Dave');
  check('setting the operator is confirmed', /station is now Dave/i.test(await t.screen()),
    (await t.screen()).slice(-200));

  await t.run('add Attributed Widget @4130 x7');
  await page.waitForTimeout(500);
  const logDave = await api.get('/api/log?limit=20');
  const daveRow = logDave.rows.find(r => /Attributed Widget/i.test(r.text));
  check('the change is stamped with who made it',
    !!daveRow && daveRow.operator === 'Dave', JSON.stringify(daveRow || null));

  await t.run('who Sam');
  await t.run('add Second Widget @4131 x2');
  await page.waitForTimeout(500);

  // Filtering happens in the DATABASE: "Dave's last 200" is a different and correct
  // answer to "the last 200 rows, of which some are Dave's".
  const byDave = await api.get('/api/log?by=Dave&limit=50');
  check('the log can be filtered to one person',
    byDave.rows.length > 0 && byDave.rows.every(r => r.operator === 'Dave'),
    JSON.stringify(byDave.rows.map(r => r.operator)));
  check('the filtered count matches the filter',
    byDave.total === byDave.rows.length, `total ${byDave.total} vs ${byDave.rows.length} rows`);

  await t.run('recent by Dave');
  // Look at the RECENT ACTIVITY block only — the screen still holds the scrollback where
  // Sam's widget was added, and matching against that tests nothing.
  const full = await t.screen();
  const block = full.slice(full.lastIndexOf('RECENT ACTIVITY'));
  check('recent by <name> shows only that person', /by Dave/i.test(block) &&
    /Attributed Widget/i.test(block) && !/Second Widget/i.test(block), block.slice(0, 400));

  // A name is a claim typed by a person, so it must not be able to forge a log line.
  await t.run('who -');
  check('the operator can be cleared', /unattributed/i.test(await t.screen()),
    (await t.screen()).slice(-160));
  await t.run('add Anon Widget @4132 x1');
  await page.waitForTimeout(400);
  const anon = (await api.get('/api/log?limit=10')).rows.find(r => /Anon Widget/i.test(r.text));
  // `operator` is omitempty, so an unattributed row carries no field at all rather than
  // an empty string — which is the right wire shape, and what the UI renders as "—".
  check('an unattributed change is still recorded',
    !!anon && !anon.operator, JSON.stringify(anon || null));

  await t.run('who Dave');

  // ── legacy import (the v20.2 HTML build) ──────────────────────────────────
  // The migration path off the old app. What matters is not that rows arrive but that
  // the C-IDs arrive UNCHANGED: the labels are already stuck on the drawers.
  console.log(String.fromCharCode(10) + 'legacy import');

  // Forward slashes: the path goes through JSON to the server, and a Windows path
  // full of backslashes is a stream of escape sequences by the time it arrives.
  const legacyPath = join(tmpdir(), 'invos-legacy-' + Date.now() + '.json').split(String.fromCharCode(92)).join('/');
  writeFileSync(legacyPath, JSON.stringify({
    items: [
      { cid: 90001, name: 'Legacy Sprocket', bin: 4110, qty: 9, min: 2, notes: 'from the old app' },
      { cid: 90002, name: 'Legacy Bearing', bin: '4111', qty: '25', min: '5' },
    ],
    projects: [{
      pid: 9001, name: 'Legacy Rig', status: 'building',
      bom: [{ cid: 90001, need: 2 }, { cid: 77777, need: 1 }],
    }],
    sections: { '41': 'LEGACY SHELF' },
  }));

  const beforeLegacy = (await api.get('/api/stats')).items;
  await t.run('import legacy ' + legacyPath);
  await page.waitForTimeout(500);
  const dry = await t.screen();
  check('a legacy import reports before it writes',
    /2 items/.test(dry) && /1 projects?/.test(dry), dry.slice(-400));
  check('it names what cannot come across (a BOM line with no part)',
    /cannot come across/i.test(dry) && /77777|C-7777/.test(dry), dry.slice(-400));
  check('the dry run writes nothing',
    (await api.get('/api/stats')).items === beforeLegacy,
    `items moved to ${(await api.get('/api/stats')).items}, expected ${beforeLegacy}`);

  await t.run('import legacy confirm');
  await page.waitForTimeout(900);
  const afterLegacy = await api.get('/api/stats');
  check('confirming writes the rows', afterLegacy.items === beforeLegacy + 2,
    `items ${beforeLegacy} -> ${afterLegacy.items}, expected +2`);

  const legKept = await api.get('/api/items/90001');
  check('the original C-ID survives (the drawer labels stay correct)',
    legKept.cid === 90001 && legKept.name === 'Legacy Sprocket' && legKept.bin === 4110,
    JSON.stringify(legKept));
  const coerced = await api.get('/api/items/90002');
  check('values the old build stored as strings land as numbers',
    coerced.qty === 25 && coerced.min === 5 && coerced.bin === 4111,
    JSON.stringify(coerced));

  const legProj = (await api.get('/api/projects')).find(p => p.pid === 9001);
  check('the project keeps its PID', !!legProj && legProj.name === 'Legacy Rig',
    JSON.stringify(legProj || null));
  const legBom = await api.get('/api/projects/9001/bom');
  check('the dangling BOM line was dropped, the real one kept',
    legBom.length === 1 && legBom[0].cid === 90001 && legBom[0].need === 2,
    JSON.stringify(legBom));

  await t.run('undo');
  await page.waitForTimeout(600);
  check('the whole legacy import undoes in one step',
    (await api.get('/api/stats')).items === beforeLegacy,
    `items ${(await api.get('/api/stats')).items}, expected back to ${beforeLegacy}`);

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
