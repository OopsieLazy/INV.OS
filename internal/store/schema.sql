-- INV.OS schema v1 — relational, not a JSON blob.
-- Every ID is AUTOINCREMENT so numbers are NEVER reused: a printed label points at
-- exactly one thing forever, which is the whole promise of the C-### / bin system.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── Dewey location model ────────────────────────────────────────────────────
-- bin is a 4-digit number that encodes where the thing physically is:
--   bin/1000      = department (0-9)
--   (bin/100)%10  = section within that department
-- Nothing stores a redundant "category" — it is always derived, so it cannot drift.

CREATE TABLE IF NOT EXISTS depts (
  n     INTEGER PRIMARY KEY CHECK (n BETWEEN 0 AND 9),
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  code  TEXT PRIMARY KEY,                    -- "11" = dept 1, section 1
  dept  INTEGER NOT NULL REFERENCES depts(n) ON DELETE CASCADE,
  digit INTEGER NOT NULL CHECK (digit BETWEEN 0 AND 9),
  label TEXT NOT NULL
);

-- ── Items ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS items (
  cid        INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  norm       TEXT    NOT NULL DEFAULT '',    -- search-normalized haystack (Ω->ohm, µ->u)
  bin        INTEGER NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 0,
  min        INTEGER NOT NULL DEFAULT 0,
  value      TEXT    NOT NULL DEFAULT '',
  pkg        TEXT    NOT NULL DEFAULT '',
  part       TEXT    NOT NULL DEFAULT '',
  supplier   TEXT    NOT NULL DEFAULT '',
  source     TEXT    NOT NULL DEFAULT '',
  link       TEXT    NOT NULL DEFAULT '',
  notes      TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  counted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_bin  ON items(bin);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name COLLATE NOCASE);
-- Covering index for the home screen and the stats line: both aggregate every item by
-- location, and both are on screen constantly. With (bin, qty) SQLite answers them by
-- scanning this narrow index instead of touching the wide rows, which is the
-- difference between a snappy home screen and a visibly slow one at 100k items.
CREATE INDEX IF NOT EXISTS idx_items_bin_qty ON items(bin, qty);
-- low stock is the hottest filtered read in the app; a partial index keeps it O(hits)
CREATE INDEX IF NOT EXISTS idx_items_low  ON items(bin) WHERE qty <= min;

-- ── Search index ────────────────────────────────────────────────────────────
-- A trigram tokenizer is the specific choice here: it indexes SUBSTRINGS, so the
-- app keeps the exact "type any fragment, anywhere in the text" behavior the HTML
-- version had, but answers from an index instead of scanning every row. Measured on
-- 100k items: 88ms per keystroke -> under 2ms.
--
-- Trigram cannot match fragments shorter than 3 characters; the Go layer falls back
-- to a LIKE filter for those, so 1- and 2-letter searches still work.

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  norm,
  content     = 'items',
  content_rowid = 'cid',
  tokenize    = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, norm) VALUES (new.cid, new.norm);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, norm) VALUES ('delete', old.cid, old.norm);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE OF norm ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, norm) VALUES ('delete', old.cid, old.norm);
  INSERT INTO items_fts(rowid, norm) VALUES (new.cid, new.norm);
END;

-- ── Shelf counters ──────────────────────────────────────────────────────────
-- The home screen shows a live count for every department, and it is the screen the
-- app returns to constantly. Recomputing it means aggregating the whole item table,
-- which grows without bound. These counters are maintained by triggers instead, so
-- the home screen costs the same at 1,000 items as at 1,000,000.

CREATE TABLE IF NOT EXISTS shelf_counts (
  dept  INTEGER NOT NULL,
  digit INTEGER NOT NULL,
  items INTEGER NOT NULL DEFAULT 0,
  qty   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dept, digit)
);

CREATE TRIGGER IF NOT EXISTS shelf_ai AFTER INSERT ON items BEGIN
  INSERT INTO shelf_counts(dept, digit, items, qty)
       VALUES (new.bin / 1000, (new.bin / 100) % 10, 1, new.qty)
  ON CONFLICT(dept, digit) DO UPDATE
     SET items = shelf_counts.items + 1,
         qty   = shelf_counts.qty + new.qty;
END;

CREATE TRIGGER IF NOT EXISTS shelf_ad AFTER DELETE ON items BEGIN
  UPDATE shelf_counts
     SET items = items - 1, qty = qty - old.qty
   WHERE dept = old.bin / 1000 AND digit = (old.bin / 100) % 10;
END;

-- Fires on a move (bin change) or a stock change; handles both by removing the old
-- contribution and adding the new one, which is correct even when both change at once.
CREATE TRIGGER IF NOT EXISTS shelf_au AFTER UPDATE OF bin, qty ON items BEGIN
  UPDATE shelf_counts
     SET items = items - 1, qty = qty - old.qty
   WHERE dept = old.bin / 1000 AND digit = (old.bin / 100) % 10;
  INSERT INTO shelf_counts(dept, digit, items, qty)
       VALUES (new.bin / 1000, (new.bin / 100) % 10, 1, new.qty)
  ON CONFLICT(dept, digit) DO UPDATE
     SET items = shelf_counts.items + 1,
         qty   = shelf_counts.qty + new.qty;
END;

-- ── Projects / BOM ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  pid        INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  notes      TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'planning',
  created_at INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bom (
  pid INTEGER NOT NULL REFERENCES projects(pid) ON DELETE CASCADE,
  cid INTEGER NOT NULL REFERENCES items(cid)    ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (pid, cid)
);
CREATE INDEX IF NOT EXISTS idx_bom_cid ON bom(cid);

-- ── Activity log / undo ─────────────────────────────────────────────────────
-- The log IS the undo stack: an entry with a non-null `undo` payload can be reversed.
-- Unbounded on purpose — this is the audit trail a shop sells on. Rows are tiny and
-- the ts index keeps `recent` O(limit) no matter how deep it gets.

CREATE TABLE IF NOT EXISTS log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  op       TEXT    NOT NULL,
  text     TEXT    NOT NULL,
  cid      INTEGER,
  operator TEXT    NOT NULL DEFAULT '',
  undo     TEXT,                              -- JSON; NULL = not undoable
  undone   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_log_ts   ON log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_log_undo ON log(id DESC) WHERE undo IS NOT NULL AND undone = 0;

-- ── Cycle count ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS countlog (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  cid      INTEGER,
  expected INTEGER NOT NULL,
  actual   INTEGER NOT NULL,
  scope    TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_countlog_ts ON countlog(ts DESC);

-- ── Photos ──────────────────────────────────────────────────────────────────
-- Blobs live in their own table so a `SELECT * FROM items` never drags image bytes
-- through memory. This is a large part of the RAM fix.

CREATE TABLE IF NOT EXISTS photos (
  cid      INTEGER PRIMARY KEY REFERENCES items(cid) ON DELETE CASCADE,
  mime     TEXT    NOT NULL DEFAULT 'image/jpeg',
  data     BLOB    NOT NULL,
  added_at INTEGER NOT NULL
);
