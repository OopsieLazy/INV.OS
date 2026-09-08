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
  /* The cap is a GUARDRAIL, not a paywall.
   *
   * Its job is to stop someone pasting ten thousand rows into localStorage and blaming
   * the app when the browser complains — not to make the demo annoying enough to buy.
   * The reason to buy is that the real one is yours and runs on your machine, which is
   * an argument that survives a sceptical reader; "we crippled the demo" is not.
   *
   * So: generous. The seed is ~140 items and the cap is 500, which leaves room to play
   * for as long as anyone wants to and still keeps the stored blob around 150KB, well
   * inside every browser's limit. */
  var CAP = 500;

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
    /* Ten departments, every one populated. A demo that only fills the electronics
       shelves shows a machinist somebody else's shop — and the shelf map and the graph
       both look thin, which is exactly the wrong first impression for the two screens
       people are most likely to screenshot. */
    var sections = {
      '01': 'ADHESIVES / TAPE', '02': 'ABRASIVES', '03': 'SAFETY',
      '11': 'RESISTORS', '12': 'CAPACITORS', '13': 'SEMICONDUCTORS',
      '14': 'CONNECTORS', '15': 'MODULES', '16': 'WIRE / CABLE',
      '21': 'SCREWS', '22': 'NUTS / WASHERS', '23': 'RIVETS / INSERTS',
      '31': 'STOCK / BAR', '32': 'CUTTING TOOLS', '33': 'WELDING',
      '41': 'SHEET GOODS', '42': 'HARDWOOD', '43': 'JOINERY',
      '51': 'FILAMENT', '52': 'PRINTER SPARES',
      '61': 'RESIN', '62': 'MOULDING',
      '71': 'LEATHER', '72': 'THREAD / HARDWARE',
      '81': 'PAINT', '82': 'FINISHES',
      '91': 'HAND TOOLS', '92': 'POWER TOOLS', '93': 'MEASURING',
    };
    for (var k in sections) db.sections[k] = sections[k];

    // name, bin, qty, min, value, package, part, notes
    var rows = [
      ['Super glue 20g', 101, 14, 5, 'cyanoacrylate', 'bottle', '', 'goes off once opened'],
      ['Epoxy 5-minute', 102, 6, 2, '2-part', 'syringe', '', ''],
      ['Masking tape 24mm', 103, 22, 8, '24mm x 50m', 'roll', '', ''],
      ['Kapton tape 10mm', 104, 9, 3, '10mm x 33m', 'roll', '', 'print bed'],
      ['Double-sided tape', 105, 7, 3, '19mm', 'roll', '', ''],
      ['Sandpaper 120g', 201, 40, 15, '120 grit', 'sheet', '', ''],
      ['Sandpaper 240g', 202, 35, 15, '240 grit', 'sheet', '', ''],
      ['Sanding block', 203, 4, 2, '', '', '', ''],
      ['Nitrile gloves L', 301, 180, 50, 'large', 'box of 100', '', ''],
      ['Safety glasses', 302, 8, 4, 'clear', '', '', ''],
      ['Dust mask P2', 303, 25, 10, 'P2', 'box', '', 'for the sander'],

      ['Resistor 10k', 1101, 180, 50, '10k 1/4W', 'THT', '', 'pull-ups; loose in bag'],
      ['Resistor 1k', 1102, 210, 60, '1k 1/4W', 'THT', '', ''],
      ['Resistor 220R', 1103, 95, 40, '220R 1/4W', 'THT', '', 'LED current limiting'],
      ['Resistor 4k7', 1104, 60, 30, '4.7k 1/4W', 'THT', '', ''],
      ['Resistor 100k', 1105, 75, 30, '100k 1/4W', 'THT', '', ''],
      ['Resistor 0.1R shunt', 1106, 12, 6, '0.1R 3W', 'THT', '', 'current sense'],
      ['Capacitor 100uF', 1201, 42, 15, '100uF 25V', 'electrolytic', '', 'watch polarity'],
      ['Capacitor 470uF', 1202, 18, 8, '470uF 35V', 'electrolytic', '', ''],
      ['Capacitor 0.1uF', 1203, 160, 60, '100nF 50V', '0805 SMD', '', 'decoupling reel cut'],
      ['Capacitor 22pF', 1204, 90, 40, '22pF', '0603 SMD', '', 'crystal load'],
      ['Diode 1N4148', 1301, 200, 50, '', 'DO-35', '1N4148', ''],
      ['Diode 1N5819', 1302, 60, 25, 'schottky 1A', 'DO-41', '1N5819', ''],
      ['MOSFET IRLZ44N', 1303, 12, 6, '55V 47A', 'TO-220', 'IRLZ44N', 'logic level'],
      ['Regulator LM2596', 1304, 9, 4, 'buck 3A', 'module', 'LM2596', ''],
      ['Op-amp LM358', 1305, 24, 10, 'dual', 'DIP-8', 'LM358', ''],
      ['LED 5mm red', 1306, 140, 50, '5mm', 'THT', '', ''],
      ['LED 5mm green', 1307, 120, 50, '5mm', 'THT', '', ''],
      ['JST-XH 2pin', 1401, 40, 15, '2.54mm', 'connector', '', ''],
      ['JST-XH 4pin', 1402, 30, 12, '2.54mm', 'connector', '', ''],
      ['Dupont header 40p', 1403, 25, 10, '2.54mm', 'strip', '', 'snap to length'],
      ['Screw terminal 2p', 1404, 35, 15, '5.08mm', 'block', '', ''],
      ['USB-C breakout', 1405, 8, 3, '', 'module', '', ''],
      ['ESP32 DevKit', 1501, 6, 2, 'WROOM-32', 'dev board', '', 'wifi + BLE'],
      ['Arduino Uno R3', 1502, 3, 2, '', 'dev board', '', ''],
      ['Raspberry Pi Pico', 1503, 5, 2, 'RP2040', 'dev board', '', ''],
      ['OLED 128x64', 1504, 4, 2, 'SSD1306', 'I2C', '', ''],
      ['Level shifter 4ch', 1505, 8, 3, '', 'module', '', ''],
      ['HC-SR04 ultrasonic', 1506, 6, 3, '', 'module', '', ''],
      ['DHT22 temp/humidity', 1507, 4, 2, '', 'module', '', ''],
      ['SDS011 dust sensor', 1508, 2, 1, 'PM2.5/PM10', 'module', '', 'the good one'],
      ['INA219 current sensor', 1509, 3, 2, 'I2C', 'module', '', ''],
      ['Relay module 4ch', 1510, 3, 1, '5V', 'module', '', ''],
      ['Breadboard 830pt', 1511, 5, 2, '', 'full size', '', ''],
      ['Jumper wires M-M', 1601, 120, 40, '20cm', 'ribbon', '', ''],
      ['Jumper wires M-F', 1602, 90, 40, '20cm', 'ribbon', '', ''],
      ['Hook-up wire 22AWG', 1603, 14, 5, '22AWG', 'reel', '', 'black/red/blue'],
      ['Mains flex 3-core', 1604, 6, 2, '0.75mm2', 'metre', '', ''],
      ['Heatshrink assorted', 1605, 3, 1, '', 'box', '', ''],

      ['M3x10 cap screw', 2101, 500, 100, 'M3x10', 'socket cap', '', 'stainless'],
      ['M3x16 cap screw', 2102, 320, 100, 'M3x16', 'socket cap', '', ''],
      ['M3x25 cap screw', 2103, 140, 60, 'M3x25', 'socket cap', '', ''],
      ['M4x20 cap screw', 2104, 180, 60, 'M4x20', 'socket cap', '', ''],
      ['M5x30 cap screw', 2105, 90, 40, 'M5x30', 'socket cap', '', ''],
      ['Wood screw 4x30', 2106, 400, 120, '4x30', 'countersunk', '', ''],
      ['M3 nyloc nut', 2201, 400, 100, 'M3', 'nyloc', '', ''],
      ['M4 nyloc nut', 2202, 220, 80, 'M4', 'nyloc', '', ''],
      ['M3 washer', 2203, 600, 150, 'M3', 'flat', '', ''],
      ['M3 T-nut', 2204, 150, 50, 'M3', '2020 extrusion', '', ''],
      ['Heat-set insert M3', 2301, 200, 60, 'M3x5', 'brass', '', 'for printed parts'],
      ['Pop rivet 4mm', 2302, 250, 80, '4x10', 'aluminium', '', ''],

      ['Aluminium 6061 bar', 3101, 8, 3, '25mm round', '300mm lengths', '', ''],
      ['Aluminium plate 6mm', 3102, 4, 2, '150x150', '6mm', '', ''],
      ['Steel flat bar', 3103, 5, 2, '25x3mm', '1m lengths', '', ''],
      ['Brass rod 6mm', 3104, 6, 2, '6mm', '300mm', '', ''],
      ['2020 extrusion', 3105, 12, 4, '20x20', '500mm', '', ''],
      ['End mill 6mm', 3201, 4, 2, '6mm 4-flute', 'carbide', '', 'for the CNC'],
      ['End mill 3mm', 3202, 6, 3, '3mm 2-flute', 'carbide', '', ''],
      ['Drill bit set', 3203, 2, 1, '1-10mm', 'HSS', '', ''],
      ['Tap M3', 3204, 3, 2, 'M3x0.5', 'HSS', '', ''],
      ['Tap M5', 3205, 2, 1, 'M5x0.8', 'HSS', '', ''],
      ['Hacksaw blade', 3206, 10, 4, '24TPI', '', '', ''],
      ['MIG wire 0.8mm', 3301, 2, 1, '0.8mm', '5kg spool', '', ''],
      ['Welding tips 0.8', 3302, 12, 5, '0.8mm', '', '', ''],

      ['Plywood 6mm', 4101, 12, 4, '600x400', 'birch', '', 'laser stock'],
      ['Plywood 12mm', 4102, 6, 2, '600x400', 'birch', '', ''],
      ['MDF 3mm', 4103, 20, 6, '600x400', '', '', ''],
      ['Acrylic 3mm clear', 4104, 9, 3, '600x400', 'cast', '', 'laser stock'],
      ['Oak board', 4201, 6, 2, '20x100x1000', 'kiln dried', '', ''],
      ['Pine batten', 4202, 18, 6, '18x44x2400', '', '', ''],
      ['Walnut offcuts', 4203, 4, 1, 'assorted', '', '', 'box under the bench'],
      ['Dowel 8mm', 4301, 60, 20, '8mm', '40mm', '', ''],
      ['Domino tenon 5mm', 4302, 120, 40, '5x30', 'beech', '', ''],
      ['Wood glue', 4303, 3, 1, 'PVA D3', '500ml', '', ''],

      ['PLA filament black', 5101, 7, 3, '1.75mm 1kg', 'spool', '', ''],
      ['PLA filament white', 5102, 4, 2, '1.75mm 1kg', 'spool', '', ''],
      ['PETG filament clear', 5103, 3, 2, '1.75mm 1kg', 'spool', '', 'runs hot'],
      ['TPU filament', 5104, 2, 1, '1.75mm 500g', 'spool', '', ''],
      ['ASA filament', 5105, 1, 1, '1.75mm 1kg', 'spool', '', 'outdoor parts'],
      ['Nozzle 0.4mm', 5201, 14, 5, '0.4mm', 'brass', '', ''],
      ['Nozzle 0.6mm', 5202, 6, 2, '0.6mm', 'hardened', '', ''],
      ['PTFE tube', 5203, 3, 1, '2x4mm', 'metre', '', ''],
      ['Build plate sheet', 5204, 2, 1, 'PEI', 'spring steel', '', ''],

      ['Resin standard grey', 6101, 3, 1, '1kg', 'bottle', '', ''],
      ['Resin tough clear', 6102, 1, 1, '1kg', 'bottle', '', ''],
      ['IPA 99%', 6103, 4, 2, '1L', 'bottle', '', 'wash tank'],
      ['Silicone RTV', 6201, 2, 1, 'shore 20', '1kg', '', ''],
      ['Mould release', 6202, 2, 1, '', 'aerosol', '', ''],

      ['Veg-tan leather 2mm', 7101, 5, 2, '2mm', 'A4 panel', '', ''],
      ['Leather dye brown', 7102, 2, 1, '', '100ml', '', ''],
      ['Waxed thread', 7201, 6, 2, '0.8mm', 'spool', '', ''],
      ['Rivets 8mm', 7202, 90, 30, '8mm', 'brass', '', ''],
      ['Snap fasteners', 7203, 60, 20, '15mm', '', '', ''],

      ['Spray primer grey', 8101, 5, 2, '', '400ml', '', ''],
      ['Spray paint black', 8102, 4, 2, 'satin', '400ml', '', ''],
      ['Enamel white', 8103, 2, 1, '', '250ml', '', ''],
      ['Danish oil', 8201, 3, 1, '', '500ml', '', ''],
      ['Beeswax finish', 8202, 2, 1, '', '200g', '', ''],
      ['Brush set', 8203, 4, 2, 'assorted', '', '', ''],

      ['Digital calipers', 9101, 2, 1, '150mm', '', '', ''],
      ['Combination square', 9102, 2, 1, '300mm', '', '', ''],
      ['Chisel set', 9103, 1, 1, '6-25mm', '', '', ''],
      ['Files assorted', 9104, 5, 2, '', '', '', ''],
      ['Soldering iron tip', 9105, 6, 3, 'chisel 2.4mm', 'T12', '', ''],
      ['Solder 0.8mm', 9106, 3, 1, '60/40', '250g', '', ''],
      ['Allen key set', 9107, 3, 2, '1.5-10mm', 'metric', '', ''],
      ['Cordless drill', 9201, 2, 1, '18V', '', '', ''],
      ['Angle grinder', 9202, 1, 1, '115mm', '', '', ''],
      ['Random orbital sander', 9203, 1, 1, '125mm', '', '', ''],
      ['Heat gun', 9204, 1, 1, '2000W', '', '', ''],
      ['Bench vice', 9205, 1, 1, '100mm', '', '', ''],
      ['Dial indicator', 9301, 1, 1, '0.01mm', '', '', ''],
      ['Feeler gauges', 9302, 2, 1, '0.05-1mm', '', '', ''],
      ['Steel rule 300mm', 9303, 4, 2, '300mm', '', '', ''],
    ];
    for (var r = 0; r < rows.length; r++) {
      var x = rows[r];
      db.items.push({
        cid: db.nextCid++, name: x[0], bin: x[1], qty: x[2], min: x[3],
        value: x[4], pkg: x[5], part: x[6], notes: x[7],
        supplier: '', source: '', link: '', created: now(), updated: now(),
      });
    }

    /* Projects reference parts BY NAME, not by a hand-counted row index. Writing a BOM
       as [12, 1] against a list anyone might reorder is how a demo quietly ends up
       showing a dust sensor made of sandpaper. */
    function cidOf(name) {
      for (var ci = 0; ci < db.items.length; ci++) {
        if (db.items[ci].name === name) return db.items[ci].cid;
      }
      throw new Error('demo seed: no item named ' + name);
    }

    /* Parts are shared ACROSS projects on purpose — the OLED, the Pico, the M3 screws,
       the heat-set inserts. Those overlaps are the bridges between clusters in the galaxy
       view; without them the graph is a row of unrelated blobs and the one screen worth
       screenshotting has nothing to show. */
    var projects = [
      ['Bench power supply', 'building', [
        ['Regulator LM2596', 2], ['M3x10 cap screw', 8], ['Hook-up wire 22AWG', 1],
        ['Screw terminal 2p', 4], ['Capacitor 470uF', 4], ['Resistor 0.1R shunt', 2],
        ['INA219 current sensor', 1], ['OLED 128x64', 1], ['Raspberry Pi Pico', 1],
        ['Heat-set insert M3', 8], ['PLA filament black', 1],
      ]],
      ['Shop dust sensor', 'building', [
        ['SDS011 dust sensor', 1], ['ESP32 DevKit', 1], ['OLED 128x64', 1],
        ['Resistor 10k', 4], ['Jumper wires M-F', 10], ['PLA filament black', 1],
        ['Heat-set insert M3', 4], ['M3x10 cap screw', 4],
      ]],
      ['CNC probe mount', 'building', [
        ['Aluminium 6061 bar', 1], ['End mill 6mm', 1], ['M4x20 cap screw', 6],
        ['M4 nyloc nut', 6], ['Tap M5', 1], ['Hook-up wire 22AWG', 1],
      ]],
      ['Laser-cut parts bin', 'done', [
        ['Plywood 6mm', 3], ['Acrylic 3mm clear', 1], ['M3x16 cap screw', 12],
        ['M3 nyloc nut', 12], ['Wood glue', 1],
      ]],
      ['Dust extraction manifold', 'planning', [
        ['PETG filament clear', 2], ['Heat-set insert M3', 12], ['M3x25 cap screw', 12],
        ['Double-sided tape', 1], ['2020 extrusion', 2],
      ]],
      ['Walnut jewellery box', 'planning', [
        ['Walnut offcuts', 1], ['Domino tenon 5mm', 8], ['Wood glue', 1],
        ['Danish oil', 1], ['Sandpaper 240g', 6], ['Rivets 8mm', 4],
      ]],
      ['Leather tool roll', 'planning', [
        ['Veg-tan leather 2mm', 2], ['Waxed thread', 1], ['Snap fasteners', 4],
        ['Leather dye brown', 1],
      ]],
      ['Filament dry box', 'building', [
        ['PLA filament white', 1], ['PTFE tube', 1], ['DHT22 temp/humidity', 1],
        ['Raspberry Pi Pico', 1], ['OLED 128x64', 1], ['Double-sided tape', 1],
        ['M3x10 cap screw', 6], ['Heat-set insert M3', 6],
      ]],
      ['Welding cart', 'planning', [
        ['Steel flat bar', 3], ['M5x30 cap screw', 8], ['MIG wire 0.8mm', 1],
        ['Welding tips 0.8', 4], ['Spray primer grey', 2], ['Spray paint black', 2],
      ]],
      ['Resin wash station', 'planning', [
        ['Acrylic 3mm clear', 1], ['IPA 99%', 2], ['Nitrile gloves L', 20],
        ['ASA filament', 1], ['M3x16 cap screw', 8],
      ]],
    ];
    for (var p2 = 0; p2 < projects.length; p2++) {
      var pr = projects[p2];
      var pid = db.nextPid++;
      db.projects.push({
        pid: pid, name: pr[0], notes: '', status: pr[1],
        created: now() - (projects.length - p2) * 86400000, active: p2 === 0,
      });
      for (var b = 0; b < pr[2].length; b++) {
        db.bom.push({ pid: pid, cid: cidOf(pr[2][b][0]), need: pr[2][b][1] });
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

  /* What the UI needs to know to be honest about being a demo. It reads these to print
     one line about the cap and to offer the download — no nag, no modal, no countdown. */
  window.__invosDemoInfo = {
    cap: CAP,
    key: KEY,
    seeded: function () { return db ? db.items.length : 0; },
    firstRun: function () {
      try { return localStorage.getItem(KEY + '-seen') !== '1'; } catch (e) { return true; }
    },
    markSeen: function () {
      try { localStorage.setItem(KEY + '-seen', '1'); } catch (e) {}
    },
  };
})();
