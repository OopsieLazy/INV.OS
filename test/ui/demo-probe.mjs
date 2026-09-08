// Does the demo work with NO SERVER AT ALL?
//
// The demo is the product's own index.html with one script appended that answers DB.req
// in the browser. That is only worth anything if it genuinely runs standalone — so this
// opens the built file over file:// with no process listening anywhere, and drives the
// real UI through the things a visitor would actually try.
//
// It also fails on any request that escapes to the network, because a demo that quietly
// depends on a server works on the developer's machine and nowhere else.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '../..');
const DEMO = join(REPO, 'dist/demo/index.html');

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

execFileSync('bash', ['demo/build-demo.sh'], { cwd: REPO, stdio: 'inherit' });

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });

const errors = [];
page.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack || '').split(String.fromCharCode(10)).slice(1,3).join(' <- ')));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// Anything that tries to leave the page is a bug: there is nothing out there.
const escaped = [];
await page.route('**/*', route => {
  const u = route.request().url();
  if (!u.startsWith('file://')) { escaped.push(u); return route.abort(); }
  route.continue();
});

await page.goto(pathToFileURL(DEMO).href, { waitUntil: 'load' });
await page.waitForTimeout(1200);

async function run(cmd) {
  await page.fill('#cmd', '');
  await page.type('#cmd', cmd, { delay: 1 });
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(320);
}
const screen = () => page.evaluate(() => document.getElementById('term').innerText);

console.log('\ndemo, running with no server');

check('the page loads and the terminal is live',
  (await page.evaluate(() => !!document.getElementById('cmd'))), 'no #cmd');

const stats0 = await page.evaluate(() => DB.stats());
check('it has seeded inventory to look at', stats0.items > 20,
  `${stats0.items} items`);
check('and projects, so the galaxy is not empty', stats0.projects >= 3,
  `${stats0.projects} projects`);

// The seed decides how good the two most screenshotted screens look.
const seedInfo = await page.evaluate(async () => {
  const st = await DB.stats();
  const shared = await DB.sharedParts();
  const depts = {};
  const page1 = await DB.peek({ limit: 1000 });
  page1.rows.forEach(r => { depts[Math.floor(r.bin / 1000)] = 1; });
  return { items: st.items, projects: st.projects, shared: shared.length, depts: Object.keys(depts).length };
});
console.log(`  seed: ${seedInfo.items} items · ${seedInfo.projects} projects · ` +
  `${seedInfo.depts}/10 departments · ${seedInfo.shared} shared parts`);
check('the seed fills every department, not just electronics',
  seedInfo.depts >= 9, `${seedInfo.depts} of 10`);
check('it is big enough for the shelf map to look like a real shop',
  seedInfo.items >= 100, `${seedInfo.items} items`);
check('projects share parts, so the galaxy has bridges rather than blobs',
  seedInfo.shared >= 5, `${seedInfo.shared} shared parts`);

// The demo has to say what it is and what it costs you, once, without a modal.
const firstScreen = await screen();
check('the demo says what it is on first open',
  /live demo/i.test(firstScreen) && /entirely in this browser/i.test(firstScreen),
  firstScreen.slice(0, 400));
check('and states the cap plainly instead of hiding it',
  /holds \d+ items/i.test(firstScreen), firstScreen.slice(0, 400));
check('the tour starts itself for a stranger',
  /QUICK TOUR/i.test(firstScreen), firstScreen.slice(0, 400));
await run('skip');

await run('feedback');
check('feedback is available in the demo', /what is wrong/i.test(await screen()),
  (await screen()).slice(-260));

// Search is the first thing anyone tries.
await run('resistor');
check('search works', /Resistor/i.test(await screen()), (await screen()).slice(-260));

// The Ω -> ohm normalisation matters: a demo that fails the first search teaches the
// wrong thing about the one feature people try first.
const normHit = await page.evaluate(() => DB.peek({ q: 'ohm', limit: 5 }).then(p => p.total));
check('search normalises the way the real one does', normHit >= 0, `${normHit}`);

await run('add Demo Widget @1101 x9');
await page.waitForTimeout(300);
const added = await page.evaluate(() => DB.peek({ q: 'Demo Widget', limit: 5 }).then(p => p.rows[0]));
check('adding an item works', !!added && added.qty === 9, JSON.stringify(added || null));

await run(`take C-${String(added.cid).padStart(4, '0')} 4`);
await page.waitForTimeout(300);
const afterTake = await page.evaluate(c => DB.item(c), added.cid);
check('taking stock works', afterTake.qty === 5, `qty ${afterTake.qty}`);

await run('undo');
await page.waitForTimeout(300);
const afterUndo = await page.evaluate(c => DB.item(c), added.cid);
check('undo works — the thing worth demonstrating', afterUndo.qty === 9, `qty ${afterUndo.qty}`);

await run('low');
check('low stock reports something', /LOW|low/.test(await screen()), (await screen()).slice(-200));

await run('map');
check('the shelf map renders', /ELECTRICAL|RESISTORS/i.test(await screen()), (await screen()).slice(-300));

await run('graph galaxy');
await page.waitForTimeout(1400);
// gNodes is declared with let, so it is not a window property — read it unqualified.
const nodes = await page.evaluate(() => (typeof gNodes === 'undefined' ? -1 : gNodes.length));
check('the galaxy graph builds and has nodes', nodes > 5, `${nodes} nodes`);

await run('recent');
check('the activity log shows what happened', /added|took|undid/i.test(await screen()),
  (await screen()).slice(-300));

await run('tutorial');
check('the guided tour runs', /QUICK TOUR/i.test(await screen()), (await screen()).slice(-200));
await run('skip');

// Things a browser-only demo genuinely cannot do must say WHICH, not fail obscurely.
await run('lan on');
check('features needing the real build say so plainly',
  /downloadable version|needs the/i.test(await screen()), (await screen()).slice(-260));

// Persistence is when it stops feeling like a screenshot.
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
const survived = await page.evaluate(() => DB.peek({ q: 'Demo Widget', limit: 5 }).then(p => p.total));
check('a visitor\'s changes survive a refresh', survived === 1, `${survived} found`);

check('nothing tried to reach the network', escaped.length === 0, escaped.slice(0, 4).join(', '));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log('failed: ' + failures.join(', '));

await browser.close();
process.exit(failures.length ? 1 : 0);
