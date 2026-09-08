/* INV.OS demo store — the server, in the browser.
 *
 * The public demo runs the SAME index.html as the product. Everything in the UI goes
 * through one function, DB.req, so this file answers that one function instead of a
 * socket. Nothing in the interface knows the difference.
 *
 * The alternative was a second, diverging copy of a 6,000-line UI kept alive purely to
 * have something to show people. That copy drifts from the product exactly when it
 * matters most — a demo that behaves differently from the thing you are selling is worse
 * than no demo.
 *
 * What this is NOT: a reimplementation of internal/store. It is a demo. It holds a few
 * hundred rows in an array, and every rule about pagination and memory that the real
 * store exists to enforce is irrelevant at that size. Where the two could differ, this
 * follows the API's OBSERVABLE behaviour — response shapes, error messages, C-IDs that
 * are never reused — because that is what the UI reacts to.
 */
(function () {
  'use strict';

  var KEY = 'invos-demo-v1';
  var CAP = 150; // the demo's item limit; see reply() for how it is enforced

  var DEFAULT_DEPTS = [
    'GENERAL / CONSUMABLES', 'ELECTRICAL / ELECTRONICS', 'FASTENERS / FITTINGS',
    'METALWORKING', 'WOODWORKING', '3D PRINTING', 'RESIN / CASTING',
    'LEATHER / TEXTILE', 'PAINT / FINISH / ADHESIVES', 'TOOLS / MACHINES',
  ];

  // ── state ────────────────────────────────────────────────────────────────
  var db = null;

  function blank() {
    return {
      items: [], projects: [], bom: [], log: [], meta: {},
      depts: {}, sections: {}, counted: {},
      nextCid: 1, nextPid: 1, nextLog: 1, activePid: null,
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { db = JSON.parse(raw); return; }
    } catch (e) { /* private window, or storage disabled */ }
    db = blank();
    seed();
    save();
  }

  var saveTimer = null;
  function save() {
    // Debounced: a bulk import writes hundreds of rows and there is no reason to
    // serialise the whole demo once per row.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
    }, 150);
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function now() { return Date.now(); }

  function err(status, message, extra) {
    var e = new Error(message);
    e.status = status;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  // Matches the server's Norm(): search has to behave the same or the demo teaches the
  // wrong thing about the one feature people try first.
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/Ω|Ω/g, 'ohm')
      .replace(/µ|μ/g, 'u')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cidStr(cid) {
    return 'C-' + String(cid).padStart(4, '0');
  }

  function hay(it) {
    return norm([it.name, it.value, it.pkg, it.part, it.notes,
      'bin ' + it.bin, cidStr(it.cid),
      db.depts[Math.floor(it.bin / 1000)] || '',
      db.sections[String(Math.floor(it.bin / 1000)) + String(Math.floor(it.bin / 100) % 10)] || '',
    ].join(' '));
  }

  function findItem(cid) {
    for (var i = 0; i < db.items.length; i++) if (db.items[i].cid === cid) return db.items[i];
    return null;
  }

  function findProject(pid) {
    for (var i = 0; i < db.projects.length; i++) if (db.projects[i].pid === pid) return db.projects[i];
    return null;
  }

  function logAdd(op, text, cid, undo) {
    db.log.push({
      id: db.nextLog++, ts: now(), op: op, text: text,
      cid: cid == null ? null : cid,
      operator: currentOperator, undo: undo || null, undone: false,
    });
  }

  // Set from the X-INVOS-Operator header the UI sends; see DB.req.
  var currentOperator = '';

  function itemOut(it) {
    var o = {
      cid: it.cid, name: it.name, bin: it.bin, qty: it.qty, min: it.min,
      value: it.value || '', pkg: it.pkg || '', part: it.part || '',
      supplier: it.supplier || '', source: it.source || '', link: it.link || '',
      notes: it.notes || '', created: it.created, updated: it.updated,
    };
    if (db.counted[it.cid]) o.counted = db.counted[it.cid];
    return o;
  }

  // ── the seed ─────────────────────────────────────────────────────────────
  /* A demo whose data looks like somebody else's shop is a demo people bounce off. This
     spreads across departments on purpose — electronics, fasteners, wood, metal, tools —
     so a machinist and an electronics person both see something familiar. */
  function seed() {
    for (var i = 0; i < DEFAULT_DEPTS.length; i++) db.depts[i] = DEFAULT_DEPTS[i];
    var sections = {
      '11': 'RESISTORS', '12': 'CAPACITORS', '13': 'SEMICONDUCTORS', '15': 'MODULES',
      '21': 'SCREWS', '22': 'NUTS / WASHERS', '31': 'STOCK / BAR', '32': 'CUTTING TOOLS',
      '41': 'SHEET GOODS', '42': 'HARDWOOD', '51': 'FILAMENT', '91': 'HAND TOOLS',
      '92': 'POWER TOOLS',
    };
    for (var k in sections) db.sections[k] = sections[k];

    var rows = [
      ['Resistor 10k', 1101, 180, 50, '10k 1/4W', 'THT', '', 'pull-ups; loose in bag'],
      ['Resistor 220R', 1102, 95, 40, '220R 1/4W', 'THT', '', 'LED current limiting'],
      ['Resistor 4k7', 1103, 60, 30, '4.7k 1/4W', 'THT', '', ''],
      ['Capacitor 100uF', 1201, 42, 15, '100uF 25V', 'electrolytic', '', 'watch polarity'],
      ['Capacitor 0.1uF', 1202, 160, 60, '100nF 50V', '0805 SMD', '', 'decoupling reel cut'],
      ['Diode 1N4148', 1301, 200, 50, '', 'DO-35', '1N4148', ''],
      ['MOSFET IRLZ44N', 1302, 12, 6, '55V 47A', 'TO-220', 'IRLZ44N', 'logic level'],
      ['ESP32 DevKit', 1501, 6, 2, 'WROOM-32', 'dev board', '', 'wifi + BLE'],
      ['Arduino Uno R3', 1502, 3, 2, '', 'dev board', '', ''],
      ['OLED 128x64', 1503, 4, 2, 'SSD1306', 'I2C', '', ''],
      ['Level shifter 4ch', 1504, 8, 3, '', 'module', '', ''],
      ['Jumper wires M-M', 1505, 120, 40, '20cm', 'ribbon', '', ''],
      ['Breadboard 830pt', 1506, 5, 2, '', 'full size', '', ''],
      ['M3x10 cap screw', 2101, 500, 100, 'M3x10', 'socket cap', '', 'stainless'],
      ['M3x16 cap screw', 2102, 320, 100, 'M3x16', 'socket cap', '', ''],
      ['M4x20 cap screw', 2103, 180, 60, 'M4x20', 'socket cap', '', ''],
      ['M3 nyloc nut', 2201, 400, 100, 'M3', 'nyloc', '', ''],
      ['M3 washer', 2202, 600, 150, 'M3', 'flat', '', ''],
      ['Aluminium 6061 bar', 3101, 8, 3, '25mm round', '300mm lengths', '', ''],
      ['Steel flat bar', 3102, 5, 2, '25x3mm', '1m lengths', '', ''],
      ['End mill 6mm', 3201, 4, 2, '6mm 4-flute', 'carbide', '', 'for the CNC'],
      ['Drill bit set', 3202, 2, 1, '1-10mm', 'HSS', '', ''],
      ['Tap M3', 3203, 3, 2, 'M3x0.5', 'HSS', '', ''],
      ['Plywood 6mm', 4101, 12, 4, '600x400', 'birch', '', 'laser stock'],
      ['MDF 3mm', 4102, 20, 6, '600x400', '', '', ''],
      ['Oak board', 4201, 6, 2, '20x100x1000', 'kiln dried', '', ''],
      ['PLA filament black', 5101, 7, 3, '1.75mm 1kg', 'spool', '', ''],
      ['PETG filament clear', 5102, 3, 2, '1.75mm 1kg', 'spool', '', 'runs hot'],
      ['Digital calipers', 9101, 2, 1, '150mm', '', '', ''],
      ['Soldering iron tip', 9102, 6, 3, 'chisel 2.4mm', 'T12', '', ''],
      ['Cordless drill', 9201, 2, 1, '18V', '', '', ''],
      ['Heat gun', 9202, 1, 1, '2000W', '', '', ''],
    ];
    for (var r = 0; r < rows.length; r++) {
      var x = rows[r];
      db.items.push({
        cid: db.nextCid++, name: x[0], bin: x[1], qty: x[2], min: x[3],
        value: x[4], pkg: x[5], part: x[6], notes: x[7],
        supplier: '', source: '', link: '', created: now(), updated: now(),
      });
    }

    var projects = [
      ['Bench power supply', 'building', [[8, 1], [10, 1], [1, 4], [4, 2], [12, 20]]],
      ['Shop dust sensor', 'planning', [[8, 1], [10, 1], [2, 3], [12, 15], [13, 1]]],
      ['CNC probe mount', 'building', [[19, 1], [21, 1], [14, 6], [17, 6]]],
      ['Laser-cut parts bin', 'done', [[24, 3], [14, 12], [17, 12]]],
    ];
    for (var p = 0; p < projects.length; p++) {
      var pr = projects[p];
      var pid = db.nextPid++;
      db.projects.push({
        pid: pid, name: pr[0], notes: '', status: pr[1],
        created: now() - (4 - p) * 86400000, active: p === 0,
      });
      for (var b = 0; b < pr[2].length; b++) {
        db.bom.push({ pid: pid, cid: pr[2][b][0], need: pr[2][b][1] });
      }
    }
    db.activePid = 1;
    db.meta.demo = '1';
    db.meta.setup_done = '1';
    logAdd('seed', 'demo inventory loaded', null, null);
  }

  // ── query ────────────────────────────────────────────────────────────────
  function queryItems(q) {
    var rows = db.items.slice();

    if (q.q) {
      var needle = norm(q.q);
      rows = rows.filter(function (it) { return hay(it).indexOf(needle) >= 0; });
    }
    if (q.bin) rows = rows.filter(function (it) { return it.bin === +q.bin; });
    if (q.dept !== undefined && q.dept !== '') {
      var d = +q.dept;
      rows = rows.filter(function (it) { return Math.floor(it.bin / 1000) === d; });
    }
    if (q.sec !== undefined && q.sec !== '') {
      var sec = +q.sec;
      rows = rows.filter(function (it) { return Math.floor(it.bin / 100) % 10 === sec; });
    }
    if (q.low === '1') rows = rows.filter(function (it) { return it.qty <= it.min; });

    var sort = q.sort || 'bin', desc = q.desc === '1';
    rows.sort(function (a, b) {
      var x, y;
      if (sort === 'name') { x = a.name.toLowerCase(); y = b.name.toLowerCase(); }
      else if (sort === 'qty') { x = a.qty; y = b.qty; }
      else if (sort === 'cid') { x = a.cid; y = b.cid; }
      else if (sort === 'updated') { x = a.updated; y = b.updated; }
      else { x = a.bin; y = b.bin; }
      if (x < y) return desc ? 1 : -1;
      if (x > y) return desc ? -1 : 1;
      return a.cid - b.cid;
    });

    var total = rows.length;
    var limit = Math.min(+q.limit || 200, 1000);
    var offset = +q.offset || 0;
    return { rows: rows.slice(offset, offset + limit).map(itemOut), total: total, capped: false };
  }

  function bomOut(pid) {
    return db.bom.filter(function (b) { return b.pid === pid; }).map(function (b) {
      var it = findItem(b.cid) || { name: '(missing)', bin: 0, qty: 0, min: 0 };
      return {
        pid: pid, cid: b.cid, name: it.name, bin: it.bin,
        need: b.need, have: it.qty, min: it.min,
      };
    }).sort(function (a, b) { return a.bin - b.bin; });
  }

  function projectOut(p) {
    return {
      pid: p.pid, name: p.name, notes: p.notes || '', status: p.status,
      created: p.created, active: !!p.active,
      parts: db.bom.filter(function (b) { return b.pid === p.pid; }).length,
    };
  }

  function stats() {
    var qty = 0, low = 0, bins = {};
    for (var i = 0; i < db.items.length; i++) {
      var it = db.items[i];
      qty += it.qty;
      if (it.qty <= it.min) low++;
      bins[it.bin] = 1;
    }
    return {
      items: db.items.length, qty: qty, low: low,
      bins: Object.keys(bins).length,
      projects: db.projects.length,
      dbBytes: (localStorage.getItem(KEY) || '').length,
    };
  }

  // ── undo ─────────────────────────────────────────────────────────────────
  /* The demo has to undo, because undo is one of the things worth demonstrating. Each
     mutation stores what it needs to reverse itself, and anything without that payload
     is simply not undoable — the same contract as the real store, minus the ops the demo
     cannot reach. */
  function undo() {
    for (var i = db.log.length - 1; i >= 0; i--) {
      var e = db.log[i];
      if (!e.undo || e.undone) continue;
      var u = e.undo;
      switch (e.op) {
        case 'add':
          db.items = db.items.filter(function (it) { return it.cid !== u.cid; });
          db.bom = db.bom.filter(function (b) { return b.cid !== u.cid; });
          break;
        case 'del':
          db.items.push(u.item);
          break;
        case 'edit':
          var it = findItem(u.cid);
          if (it) for (var k in u.before) it[k] = u.before[k];
          break;
        case 'take': case 'stock':
          var t = findItem(u.cid);
          if (t) t.qty = Math.max(0, t.qty - u.delta);
          break;
        case 'import':
          db.items = db.items.filter(function (x) { return x.cid < u.from || x.cid > u.to; });
          break;
        case 'proj.add':
          db.projects = db.projects.filter(function (p) { return p.pid !== u.pid; });
          db.bom = db.bom.filter(function (b) { return b.pid !== u.pid; });
          break;
        case 'proj.del':
          db.projects.push(u.proj);
          if (u.bom) db.bom = db.bom.concat(u.bom);
          break;
        case 'bom.set':
          db.bom = db.bom.filter(function (b) { return !(b.pid === u.pid && b.cid === u.cid); });
          if (u.existed) db.bom.push({ pid: u.pid, cid: u.cid, need: u.before });
          break;
        case 'bom.del':
          db.bom.push({ pid: u.pid, cid: u.cid, need: u.before });
          break;
        case 'build':
          for (var b2 = 0; b2 < (u.took || []).length; b2++) {
            var bi = findItem(u.took[b2].cid);
            if (bi) bi.qty += u.took[b2].qty;
          }
          var bp = findProject(u.pid);
          if (bp && u.status) bp.status = u.status;
          break;
        case 'count':
          var ci = findItem(u.cid);
          if (ci) ci.qty = u.before;
          break;
        default:
          // Same rule as the real store: an op with an undo payload and no handler is a
          // bug, not something to shrug at.
          throw err(500, 'cannot undo ' + e.op + ' in the demo');
      }
      e.undone = true;
      logAdd('undo', 'undid: ' + e.text, e.cid, null);
      save();
      // The API's shape, not the entry's: the UI reads res.undone and res.entry.text.
      // Returning the bare entry looked right and was wrong, which is exactly the class
      // of bug this shim exists to avoid — so the demo-probe asserts undo works.
      return { undone: true, entry: { id: e.id, ts: e.ts, op: e.op, text: e.text, cid: e.cid } };
    }
    // Not an error: "nothing left to undo" is an ordinary answer, and the real API says
    // so with 200 rather than a failure the UI would render as red.
    return { undone: false, reason: 'nothing left to undo' };
  }

  // ── routing ──────────────────────────────────────────────────────────────
  function parseQuery(path) {
    var i = path.indexOf('?');
    var out = {};
    if (i < 0) return out;
    var sp = new URLSearchParams(path.slice(i + 1));
    sp.forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function reply(method, fullPath, body) {
    var path = fullPath.split('?')[0];
    var q = parseQuery(fullPath);
    var m;

    // ── items ──
    if (path === '/api/items' && method === 'GET') return queryItems(q);

    if (path === '/api/items' && method === 'POST') {
      if (db.items.length >= CAP) {
        throw err(507, 'the demo holds ' + CAP + ' items — the real thing has no limit');
      }
      var it = {
        cid: db.nextCid++, name: String(body.name || '').trim(),
        bin: +body.bin || 0, qty: +body.qty || 0, min: +body.min || 0,
        value: body.value || '', pkg: body.pkg || '', part: body.part || '',
        supplier: body.supplier || '', source: body.source || '', link: body.link || '',
        notes: body.notes || '', created: now(), updated: now(),
      };
      if (!it.name) throw err(400, 'an item needs a name');
      db.items.push(it);
      logAdd('add', 'added ' + cidStr(it.cid) + ' ' + it.name + ' x' + it.qty + ' to bin ' + it.bin,
        it.cid, { cid: it.cid });
      save();
      return itemOut(it);
    }

    if (path === '/api/items/bulk' && method === 'POST') {
      var list = body.items || [];
      var room = CAP - db.items.length;
      if (list.length > room) {
        throw err(507, 'the demo has room for ' + Math.max(0, room) + ' more items');
      }
      var first = db.nextCid;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        db.items.push({
          cid: db.nextCid++, name: r.name, bin: +r.bin || 0, qty: +r.qty || 0,
          min: +r.min || 0, value: r.value || '', pkg: r.pkg || '', part: r.part || '',
          supplier: r.supplier || '', source: r.source || '', link: r.link || '',
          notes: r.notes || '', created: now(), updated: now(),
        });
      }
      logAdd('import', 'imported ' + list.length + ' items (' + (body.source || 'import') + ')',
        null, { from: first, to: db.nextCid - 1 });
      save();
      return { added: list.length };
    }

    if ((m = path.match(/^\/api\/items\/(\d+)$/))) {
      var cid = +m[1], target = findItem(cid);
      if (!target) throw err(404, 'no item ' + cidStr(cid));
      if (method === 'GET') return itemOut(target);
      if (method === 'PATCH') {
        var before = {};
        for (var k in body) { before[k] = target[k]; target[k] = body[k]; }
        target.updated = now();
        logAdd('edit', 'edited ' + cidStr(cid) + ' ' + target.name, cid, { cid: cid, before: before });
        save();
        return itemOut(target);
      }
      if (method === 'DELETE') {
        var copy = JSON.parse(JSON.stringify(target));
        db.items = db.items.filter(function (x) { return x.cid !== cid; });
        db.bom = db.bom.filter(function (b) { return b.cid !== cid; });
        logAdd('del', 'deleted ' + cidStr(cid) + ' ' + copy.name, cid, { item: copy });
        save();
        return null;
      }
    }

    if ((m = path.match(/^\/api\/items\/(\d+)\/qty$/)) && method === 'POST') {
      var acid = +m[1], ai = findItem(acid);
      if (!ai) throw err(404, 'no item ' + cidStr(acid));
      var delta = +body.delta || 0;
      if (ai.qty + delta < 0) throw err(400, 'only ' + ai.qty + ' left');
      ai.qty += delta; ai.updated = now();
      logAdd(delta < 0 ? 'take' : 'stock',
        (delta < 0 ? 'took ' + (-delta) + ' from ' : 'added ' + delta + ' to ') + cidStr(acid) + ' ' + ai.name,
        acid, { cid: acid, delta: delta });
      save();
      return itemOut(ai);
    }

    if (path === '/api/bins/next' && method === 'GET') {
      var d = +q.dept || 0, sc = +q.sec || 0;
      var base = d * 1000 + sc * 100;
      for (var n = 10; n < 100; n++) {
        var bin = base + n, taken = false;
        for (var j = 0; j < db.items.length; j++) if (db.items[j].bin === bin) { taken = true; break; }
        if (!taken) return { bin: bin };
      }
      throw err(409, 'that shelf is full');
    }

    // ── layout ──
    if (path === '/api/depts' && method === 'GET') {
      return Object.keys(db.depts).map(function (n) {
        return { n: +n, label: db.depts[n] };
      }).sort(function (a, b) { return a.n - b.n; });
    }
    if ((m = path.match(/^\/api\/depts\/(\d)$/)) && method === 'PUT') {
      db.depts[+m[1]] = body.label; save(); return null;
    }
    if (path === '/api/sections' && method === 'GET') {
      return Object.keys(db.sections).map(function (code) {
        return { code: code, dept: +code[0], digit: +code[1], label: db.sections[code] };
      }).filter(function (x) { return q.dept === undefined || q.dept === '' || x.dept === +q.dept; })
        .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    }
    if ((m = path.match(/^\/api\/sections\/(\d\d)$/)) && method === 'PUT') {
      if (body.label) db.sections[m[1]] = body.label; else delete db.sections[m[1]];
      save(); return null;
    }

    // ── projects ──
    if (path === '/api/projects' && method === 'GET') return db.projects.map(projectOut);
    if (path === '/api/projects' && method === 'POST') {
      var np = { pid: db.nextPid++, name: body.name, notes: '', status: 'planning', created: now(), active: false };
      db.projects.push(np);
      logAdd('proj.add', 'new project: ' + np.name, null, { pid: np.pid });
      save();
      return projectOut(np);
    }
    if ((m = path.match(/^\/api\/projects\/(\d+)$/))) {
      var pid = +m[1], pr = findProject(pid);
      if (!pr) throw err(404, 'no project ' + pid);
      if (method === 'GET') return projectOut(pr);
      if (method === 'PATCH') {
        for (var pk in body) pr[pk] = body[pk];
        save(); return projectOut(pr);
      }
      if (method === 'DELETE') {
        var pcopy = JSON.parse(JSON.stringify(pr));
        var pbom = db.bom.filter(function (b) { return b.pid === pid; });
        db.projects = db.projects.filter(function (x) { return x.pid !== pid; });
        db.bom = db.bom.filter(function (b) { return b.pid !== pid; });
        logAdd('proj.del', 'deleted project ' + pcopy.name, null, { proj: pcopy, bom: pbom });
        save(); return null;
      }
    }
    if ((m = path.match(/^\/api\/projects\/(\d+)\/active$/)) && method === 'POST') {
      db.projects.forEach(function (p) { p.active = p.pid === +m[1]; });
      db.activePid = +m[1]; save(); return null;
    }
    if ((m = path.match(/^\/api\/projects\/(\d+)\/bom$/)) && method === 'GET') return bomOut(+m[1]);

    if ((m = path.match(/^\/api\/projects\/(\d+)\/bom\/(\d+)$/))) {
      var bpid = +m[1], bcid = +m[2];
      var line = null;
      for (var bi2 = 0; bi2 < db.bom.length; bi2++) {
        if (db.bom[bi2].pid === bpid && db.bom[bi2].cid === bcid) { line = db.bom[bi2]; break; }
      }
      if (method === 'PUT') {
        var beforeNeed = line ? line.need : 0;
        if (line) line.need = +body.need; else db.bom.push({ pid: bpid, cid: bcid, need: +body.need });
        logAdd('bom.set', 'set ' + cidStr(bcid) + ' x' + body.need, bcid,
          { pid: bpid, cid: bcid, before: beforeNeed, existed: !!line });
        save(); return null;
      }
      if (method === 'DELETE') {
        if (!line) throw err(404, 'not on this project');
        db.bom = db.bom.filter(function (b) { return !(b.pid === bpid && b.cid === bcid); });
        logAdd('bom.del', 'removed ' + cidStr(bcid), bcid, { pid: bpid, cid: bcid, before: line.need });
        save(); return null;
      }
    }

    if ((m = path.match(/^\/api\/projects\/(\d+)\/build$/)) && method === 'POST') {
      var vpid = +m[1], lines = bomOut(vpid), short = [], took = [];
      for (var li = 0; li < lines.length; li++) {
        if (lines[li].have < lines[li].need) short.push(lines[li]);
      }
      if (short.length && !body.partial) throw err(409, 'not enough stock', { short: short });
      for (var lj = 0; lj < lines.length; lj++) {
        var bit = findItem(lines[lj].cid);
        if (!bit) continue;
        var take = Math.min(bit.qty, lines[lj].need);
        if (take <= 0) continue;
        bit.qty -= take; bit.updated = now();
        took.push({ cid: bit.cid, qty: take });
      }
      var bproj = findProject(vpid);
      var prevStatus = bproj ? bproj.status : '';
      if (bproj) bproj.status = 'building';
      logAdd('build', 'built ' + (bproj ? bproj.name : vpid) + ' — took ' + took.length + ' part lines',
        null, { pid: vpid, took: took, status: prevStatus });
      save();
      return { taken: took.length, short: short };
    }

    if (path === '/api/shared-parts' && method === 'GET') {
      var byCid = {};
      db.bom.forEach(function (b) { (byCid[b.cid] = byCid[b.cid] || []).push(b.pid); });
      var out = [];
      for (var sc2 in byCid) {
        if (byCid[sc2].length > 1) {
          var si = findItem(+sc2);
          out.push({ cid: +sc2, name: si ? si.name : '', pids: byCid[sc2], count: byCid[sc2].length });
        }
      }
      return out;
    }

    // ── log / undo ──
    if (path === '/api/log' && method === 'GET') {
      var rows = db.log.slice();
      if (q.by) {
        rows = rows.filter(function (e) {
          return (e.operator || '').toLowerCase() === q.by.toLowerCase();
        });
      }
      if (q.cid) rows = rows.filter(function (e) { return e.cid === +q.cid; });
      var lt = rows.length;
      rows = rows.slice().reverse().slice(+q.offset || 0, (+q.offset || 0) + (+q.limit || 20));
      return {
        total: lt,
        rows: rows.map(function (e) {
          var o = { id: e.id, ts: e.ts, op: e.op, text: e.text, undoable: !!e.undo, undone: !!e.undone };
          if (e.cid != null) o.cid = e.cid;
          if (e.operator) o.operator = e.operator;
          return o;
        }),
      };
    }
    if (path === '/api/undo' && method === 'POST') return undo();

    // ── cycle count ──
    if ((m = path.match(/^\/api\/items\/(\d+)\/count$/)) && method === 'POST') {
      var ccid = +m[1], ci2 = findItem(ccid);
      if (!ci2) throw err(404, 'no item ' + cidStr(ccid));
      var beforeQty = ci2.qty;
      ci2.qty = +body.actual; ci2.updated = now();
      db.counted[ccid] = now();
      logAdd('count', 'counted ' + cidStr(ccid) + ': ' + beforeQty + ' -> ' + ci2.qty, ccid,
        { cid: ccid, before: beforeQty });
      save();
      return itemOut(ci2);
    }
    if (path === '/api/countlog' && method === 'GET') {
      return db.log.filter(function (e) { return e.op === 'count'; })
        .slice(-(+q.limit || 50)).reverse()
        .map(function (e) { return { ts: e.ts, cid: e.cid, text: e.text }; });
    }

    // ── meta / stats / server ──
    if ((m = path.match(/^\/api\/meta\/(.+)$/))) {
      var mk = decodeURIComponent(m[1]);
      if (method === 'GET') return { key: mk, value: db.meta[mk] === undefined ? '' : db.meta[mk] };
      if (method === 'PUT') { db.meta[mk] = body.value; save(); return null; }
    }
    if (path === '/api/stats' && method === 'GET') return stats();
    if (path === '/api/health' && method === 'GET') return { ok: true };

    if (path === '/api/server' && method === 'GET') {
      return {
        version: 'demo', build: 'demo', dbPath: 'your browser', dbBytes: stats().dbBytes,
        port: 0, lan: false, urls: [], tokenSet: false, startedAt: startedAt,
        canToggleLan: false, demo: true,
      };
    }

    // Photos and shop access are the two things a browser-only demo genuinely cannot do.
    // Say which, rather than failing with something the user cannot act on.
    if (/^\/api\/photos/.test(path) || /\/photo$/.test(path)) {
      throw err(501, 'photos need the downloadable version — the demo runs entirely in this tab');
    }
    if (/^\/api\/lan/.test(path)) {
      throw err(501, 'shop access needs the downloadable version');
    }
    if (/^\/api\/import\/legacy/.test(path)) {
      throw err(501, 'legacy import needs the downloadable version');
    }
    if (/^\/api\/backup/.test(path)) {
      throw err(501, 'backup needs the downloadable version — this demo lives in your browser');
    }

    throw err(404, 'the demo does not implement ' + method + ' ' + path);
  }

  var startedAt = now();

  // ── the hook the UI calls ────────────────────────────────────────────────
  window.__invosDemo = function (method, path, body) {
    if (!db) load();
    // The UI sends the operator as a header; there are no headers here, so read it from
    // the same place the UI got it.
    try { currentOperator = (window.state && window.state.operator) || ''; } catch (e) {}
    return new Promise(function (resolve, reject) {
      // A microtask, so callers that assume async stay async and nothing subtly changes
      // behaviour between the demo and the product.
      setTimeout(function () {
        try { resolve(reply(method, path, body)); }
        catch (e) { reject(e); }
      }, 0);
    });
  };

  // `demo reset` in the console, and the UI's own reset paths.
  window.__invosDemoReset = function () {
    db = blank(); seed();
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  };

  window.__invosDemoInfo = { cap: CAP, key: KEY };
})();
