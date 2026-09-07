// Seeds a large inventory and screenshots the graph, so "it renders fast" can be
// checked against "it still looks like something".
//
//   node graph-shot.mjs [itemCount]
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const OUT = resolve(import.meta.dirname);
const PORT = 8219;
const BASE = `http://127.0.0.1:${PORT}`;
const N = Number(process.argv[2] || 20000);

function chromePath() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  for (const b of ['chromium-1217', 'chromium-1216']) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = join(root, b, sub);
      if (existsSync(p)) return p;
    }
  }
}

const kinds = ['Resistor', 'Capacitor', 'Screw', 'Bolt', 'Bearing', 'Sensor', 'Module',
  'Connector', 'Cable', 'Bit', 'Blade', 'Filament', 'Resin', 'Paint', 'Glue', 'Wire'];
const quals = ['10kΩ', '100µF', 'M3', 'M4', '12V', '5V', 'SMD', 'THT', 'brass', 'nylon'];

const dbDir = mkdtempSync(join(tmpdir(), 'invos-shot-'));
execFileSync('go', ['build', '-o', 'invos-shot.exe', './cmd/invos'], {
  cwd: REPO, stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Go\\bin` },
});
const server = spawn(join(REPO, 'invos-shot.exe'),
  ['-db', join(dbDir, 's.db'), '-port', String(PORT), '-open=false'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

console.log(`seeding ${N} items…`);
for (let done = 0; done < N; done += 2000) {
  const items = [];
  for (let i = done; i < Math.min(N, done + 2000); i++) {
    const d = i % 10, s = (i / 10 | 0) % 10;
    items.push({
      name: `${kinds[i % kinds.length]} ${quals[i % quals.length]} ${i}`,
      bin: d * 1000 + s * 100 + (i % 90) + 10,
      qty: i % 200, min: i % 17 === 0 ? 500 : 2,   // ~6% low, so amber shows
    });
  }
  await fetch(`${BASE}/api/items/bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, source: 'shot' }),
  });
  process.stdout.write(`\r  ${Math.min(N, done + 2000)}/${N}`);
}
console.log('');

// a few projects so the galaxy has clusters
for (const name of ['Weather Station', 'Robot Arm', 'Desk Clock', 'Line Follower', 'CNC Spindle']) {
  const p = await (await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })).json();
  for (let k = 0; k < 40; k++) {
    const cid = 1 + ((k * 37 + p.pid * 11) % Math.min(N, 4000));
    await fetch(`${BASE}/api/projects/${p.pid}/bom/${cid}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ need: 1 + (k % 4) }),
    });
  }
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

async function run(cmd) {
  await page.fill('#cmd', '');
  await page.type('#cmd', cmd, { delay: 2 });
  await page.press('#cmd', 'Enter');
  await page.waitForTimeout(600);
}

await run('__fr_go');          // skip the welcome doors
for (const [view, file] of [['graph inv', 'graph-inventory.png'], ['graph galaxy', 'graph-galaxy.png']]) {
  await run('graph full');
  await run(view);
  await run('graph 3d');
  await page.waitForTimeout(6000);    // let the layout settle
  const stats = await page.evaluate(() => {
    const ext = (f) => { let lo=1e9, hi=-1e9; for (const n of gNodes){ const v=f(n); if(v<lo)lo=v; if(v>hi)hi=v; } return [Math.round(lo), Math.round(hi)]; };
    return {
      nodes: gNodes.length,
      parts: gNodes.filter(n => n.type === 'part' || n.type === 'shared').length,
      view: gView.kind,
      x: ext(n=>n.x), y: ext(n=>n.y), z: ext(n=>n.z||0),
      scale: +gScale.toFixed(3), alpha: +gAlpha.toFixed(4),
      hubs: gNodes.filter(n=>n.type==='dept').slice(0,4).map(n=>[Math.round(n.x),Math.round(n.y),Math.round(n.z||0)]),
    };
  });
  await page.screenshot({ path: join(OUT, file) });
  console.log(file+":", JSON.stringify(stats));
}

await browser.close();
server.kill();
await new Promise(r => server.on('exit', r));
try { rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
