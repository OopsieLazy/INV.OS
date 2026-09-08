package store

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite: no cgo, so one static binary per platform
)

//go:embed schema.sql
var schemaSQL string

// ErrNotFound is returned for any missing row so the API can map it to a 404.
var ErrNotFound = errors.New("not found")

// SQLite is the shop-product Store. One file on disk, WAL mode, no server process.
type SQLite struct {
	db   *sql.DB
	path string
}

// OpenSQLite opens (creating if needed) the database at path and applies the schema.
//
// Pragmas are set in the DSN so every pooled connection gets them — setting them with
// a stray Exec only configures whichever connection happened to serve it, which is a
// classic source of "WAL didn't actually turn on".
func OpenSQLite(path string) (*SQLite, error) {
	dsn := "file:" + url.PathEscape(path) +
		"?_pragma=journal_mode(WAL)" + // concurrent readers alongside one writer
		"&_pragma=busy_timeout(5000)" + // wait out a writer instead of erroring
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)" // WAL + NORMAL is durable across app crashes

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	// WAL gives us real read concurrency for the shop's tablets; writes still serialize
	// inside SQLite and busy_timeout absorbs the contention.
	conns := runtime.NumCPU()
	if conns < 4 {
		conns = 4
	}
	db.SetMaxOpenConns(conns)
	db.SetMaxIdleConns(conns)
	db.SetConnMaxIdleTime(5 * time.Minute)

	s := &SQLite{db: db, path: path}
	if err := s.init(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *SQLite) init() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := s.db.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key='schema_version'`).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return s.seed(ctx)
	}
	if err != nil {
		return err
	}
	return s.backfill(ctx)
}

// backfill rebuilds the derived structures — the search index and the shelf counters —
// when a database predates them. Both are maintained by triggers from then on, so this
// runs once and costs nothing on every later start.
func (s *SQLite) backfill(ctx context.Context) error {
	var items, counted int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM items`).Scan(&items); err != nil {
		return err
	}
	if items == 0 {
		return nil
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(items),0) FROM shelf_counts`).Scan(&counted); err != nil {
		return err
	}
	if counted == items {
		return nil
	}
	slog.Info("rebuilding derived indexes", "items", items)
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM shelf_counts`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO shelf_counts(dept, digit, items, qty)
			SELECT bin / 1000, (bin / 100) % 10, COUNT(*), SUM(qty)
			  FROM items GROUP BY bin / 1000, (bin / 100) % 10`); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO items_fts(items_fts) VALUES('rebuild')`)
		return err
	})
}

// DefaultDepts are the ten top-level departments, carried over from the HTML app so
// an existing shop's printed bin labels keep meaning the same thing.
var DefaultDepts = []string{
	"GENERAL / CONSUMABLES", "ELECTRICAL / ELECTRONICS", "FASTENERS / FITTINGS",
	"METALWORKING", "WOODWORKING", "3D PRINTING", "RESIN / CASTING",
	"LEATHER / TEXTILE", "PAINT / FINISH / ADHESIVES", "TOOLS / MACHINES",
}

// DefaultSections are the starter shelves. Every one is renameable at runtime.
var DefaultSections = map[string]string{
	"11": "RESISTORS", "12": "CAPACITORS", "13": "ICs / SEMICONDUCTORS", "14": "SENSORS",
	"15": "MODULES / DISPLAYS", "16": "BOARDS / MCUs", "17": "CONNECTORS", "18": "WIRE / CABLE",
	"21": "BOLTS / SCREWS", "22": "NUTS / WASHERS", "23": "RIVETS / PINS", "24": "HINGES / BRACKETS",
	"31": "STOCK / BAR / SHEET", "32": "CUTTING TOOLS", "33": "WELDING",
	"41": "LUMBER / SHEET", "42": "DOWELS / TRIM",
	"51": "FILAMENT", "52": "NOZZLES / HOTEND", "53": "BUILD SURFACES",
	"61": "RESINS", "62": "MOLDS / SILICONE",
	"71": "LEATHER / HIDE", "72": "THREAD / HARDWARE",
	"81": "PAINT / STAIN", "82": "GLUE / ADHESIVES", "83": "ABRASIVES / POLISH",
	"91": "BENCH / HAND TOOLS", "92": "SOLDERING",
}

func (s *SQLite) seed(ctx context.Context) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		for n, label := range DefaultDepts {
			if _, err := tx.ExecContext(ctx, `INSERT INTO depts(n,label) VALUES(?,?)`, n, label); err != nil {
				return err
			}
		}
		codes := make([]string, 0, len(DefaultSections))
		for code := range DefaultSections {
			codes = append(codes, code)
		}
		sort.Strings(codes) // deterministic seed order keeps fresh DBs byte-comparable
		for _, code := range codes {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO sections(code,dept,digit,label) VALUES(?,?,?,?)`,
				code, int(code[0]-'0'), int(code[1]-'0'), DefaultSections[code]); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx,
			`INSERT INTO meta(key,value) VALUES('schema_version','1'),('shop_name','')`)
		return err
	})
}

func (s *SQLite) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *SQLite) Close() error { return s.db.Close() }

// ── search normalization ────────────────────────────────────────────────────
// Matches the HTML app's rules exactly so a shop's muscle memory survives the port:
// "100uf" finds 100µF and "10kohm" finds 10kΩ from a plain keyboard.

var normReplacer = strings.NewReplacer("µ", "u", "Ω", "ohm", "ω", "ohm")

// Norm lowercases and folds the unit characters people cannot type.
func Norm(s string) string { return normReplacer.Replace(strings.ToLower(s)) }

// CIDStr renders the permanent short ID a physical label carries.
func CIDStr(cid int64) string { return fmt.Sprintf("C-%03d", cid) }

// haystack builds the searchable text for one item, including its location labels so
// "resistors" finds everything on that shelf. Stored on the row and rebuilt whenever
// the item or its shelf label changes.
func (s *SQLite) haystack(ctx context.Context, q queryer, it Item) (string, error) {
	var deptLabel, secLabel string
	_ = q.QueryRowContext(ctx, `SELECT label FROM depts WHERE n=?`, it.Dept()).Scan(&deptLabel)
	_ = q.QueryRowContext(ctx, `SELECT label FROM sections WHERE code=?`,
		fmt.Sprintf("%d%d", it.Dept(), it.Section())).Scan(&secLabel)
	return Norm(strings.Join([]string{
		it.Name, it.Value, it.Pkg, it.Part, it.Notes,
		fmt.Sprintf("bin %d", it.Bin), CIDStr(it.CID), deptLabel, secLabel,
	}, " ")), nil
}

// queryer is satisfied by both *sql.DB and *sql.Tx.
type queryer interface {
	QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
	QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error)
}

// ── items ───────────────────────────────────────────────────────────────────

const itemCols = `cid,name,bin,qty,min,value,pkg,part,supplier,source,link,notes,created_at,updated_at,counted_at`

func scanItem(sc interface{ Scan(...any) error }) (Item, error) {
	var it Item
	err := sc.Scan(&it.CID, &it.Name, &it.Bin, &it.Qty, &it.Min, &it.Value, &it.Pkg,
		&it.Part, &it.Supplier, &it.Source, &it.Link, &it.Notes,
		&it.CreatedAt, &it.UpdatedAt, &it.CountedAt)
	return it, err
}

// minTrigram is the shortest fragment the trigram index can match. Anything shorter
// falls back to a LIKE scan, which is fine because it is rare and still correct.
const minTrigram = 3

// ftsQuote renders a fragment as an FTS5 string literal ("" escapes a quote).
func ftsQuote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

// buildFrom decides how the item table is reached. Search fragments of three or more
// characters go through the trigram index; shorter ones stay as LIKE predicates, so
// behavior is identical either way and only the speed differs.
func buildFrom(q ItemQuery) (from string, match string, likeToks []string) {
	for _, tok := range strings.Fields(Norm(q.Search)) {
		if len([]rune(tok)) >= minTrigram {
			if match != "" {
				match += " AND "
			}
			match += ftsQuote(tok)
		} else {
			likeToks = append(likeToks, tok)
		}
	}
	if match == "" {
		return " FROM items", "", likeToks
	}
	return " FROM items JOIN items_fts ON items_fts.rowid = items.cid", match, likeToks
}

// buildQuery turns an ItemQuery into the FROM and WHERE halves of a statement plus
// their arguments. Search tokens are AND-matched as substrings — the same semantics
// as the HTML app, so results never change under a user's feet — but long fragments
// are served by the trigram index rather than a table scan.
func buildQuery(q ItemQuery) (from, where string, args []any) {
	var conds []string

	from, match, likeToks := buildFrom(q)
	if match != "" {
		conds = append(conds, "items_fts MATCH ?")
		args = append(args, match)
	}
	for _, tok := range likeToks {
		conds = append(conds, "items.norm LIKE ? ESCAPE '\\'")
		args = append(args, "%"+escapeLike(tok)+"%")
	}
	if q.Bin != nil {
		conds = append(conds, "bin = ?")
		args = append(args, *q.Bin)
	}
	// Filter by a bin RANGE rather than by arithmetic on the column. `bin / 1000 = ?`
	// hides the column inside an expression, so SQLite cannot use the bin index and
	// scans the table; `bin BETWEEN lo AND hi` is an index range scan.
	if q.Dept != nil {
		lo, hi := *q.Dept*1000, *q.Dept*1000+999
		if q.Sec != nil {
			lo, hi = lo+*q.Sec*100, lo+*q.Sec*100+99
		}
		conds = append(conds, "bin BETWEEN ? AND ?")
		args = append(args, lo, hi)
	}
	if q.LowSet {
		conds = append(conds, "qty <= min")
	}
	if len(conds) == 0 {
		return from, "", nil
	}
	return from, " WHERE " + strings.Join(conds, " AND "), args
}

// escapeLike neutralizes the LIKE wildcards so a search for "50%" is a literal search.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

var sortCols = map[string]string{
	"name":    "name COLLATE NOCASE",
	"bin":     "bin",
	"qty":     "qty",
	"updated": "updated_at",
}

// Items returns one page of matching items plus the full match count.
func (s *SQLite) Items(ctx context.Context, q ItemQuery) (Page[Item], error) {
	from, where, args := buildQuery(q)

	order, ok := sortCols[q.Sort]
	if !ok {
		order = "bin, name COLLATE NOCASE" // shelf order: how you walk the actual room
	}
	if q.Desc {
		order += " DESC"
	}
	limit := q.Limit
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}

	var page Page[Item]
	var countSQL, rowSQL string
	countArgs := args
	rowArgs := append(append([]any{}, args...), limit, q.Offset)

	if q.Approx {
		// Stop after CountCap matches and sort only within that candidate set. Both the
		// exact count and the global sort force SQLite to visit every match, which is
		// what made a common word cost 68ms per keystroke; the user is reading the top
		// handful of rows, so neither is worth paying for on every character typed.
		countSQL = `SELECT COUNT(*) FROM (SELECT items.cid` + from + where + ` LIMIT ?)`
		countArgs = append(append([]any{}, args...), CountCap+1)
		rowSQL = `SELECT ` + itemCols + ` FROM (SELECT ` + itemCols + from + where +
			` LIMIT ?) ORDER BY ` + order + ` LIMIT ? OFFSET ?`
		rowArgs = append(append([]any{}, args...), CountCap, limit, q.Offset)
	} else {
		countSQL = `SELECT COUNT(*)` + from + where
		rowSQL = `SELECT ` + itemCols + from + where + ` ORDER BY ` + order + ` LIMIT ? OFFSET ?`
	}

	if err := s.db.QueryRowContext(ctx, countSQL, countArgs...).Scan(&page.Total); err != nil {
		return page, err
	}
	if q.Approx && page.Total > CountCap {
		page.Total, page.Capped = CountCap, true
	}

	rows, err := s.db.QueryContext(ctx, rowSQL, rowArgs...)
	if err != nil {
		return page, err
	}
	defer rows.Close()

	page.Rows = make([]Item, 0, limit)
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return page, err
		}
		page.Rows = append(page.Rows, it)
	}
	return page, rows.Err()
}

// Item fetches one item by its permanent CID.
func (s *SQLite) Item(ctx context.Context, cid int64) (Item, error) {
	it, err := scanItem(s.db.QueryRowContext(ctx, `SELECT `+itemCols+` FROM items WHERE cid=?`, cid))
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return it, err
}

// AddItem inserts a new item, assigning it a permanent CID, and logs the mutation.
func (s *SQLite) AddItem(ctx context.Context, it Item) (Item, error) {
	now := time.Now().UnixMilli()
	it.CreatedAt, it.UpdatedAt = now, now

	err := s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx,
			`INSERT INTO items(name,norm,bin,qty,min,value,pkg,part,supplier,source,link,notes,created_at,updated_at)
			 VALUES(?,'',?,?,?,?,?,?,?,?,?,?,?,?)`,
			it.Name, it.Bin, it.Qty, it.Min, it.Value, it.Pkg, it.Part,
			it.Supplier, it.Source, it.Link, it.Notes, now, now)
		if err != nil {
			return err
		}
		if it.CID, err = res.LastInsertId(); err != nil {
			return err
		}
		// norm needs the CID (labels are searchable by C-ID), so it is a second pass
		hay, err := s.haystack(ctx, tx, it)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, it.CID); err != nil {
			return err
		}
		undo, _ := json.Marshal(map[string]any{"cid": it.CID})
		return appendLog(ctx, tx, "add",
			fmt.Sprintf("added %s %s x%d to bin %04d", CIDStr(it.CID), it.Name, it.Qty, it.Bin),
			&it.CID, string(undo))
	})
	return it, err
}

// BulkAdd inserts many items under a single transaction, prepared statement, and log
// entry. This is the import path: one 10k-row spreadsheet is one undoable action, and
// the per-row cost drops by roughly two orders of magnitude versus looping AddItem.
//
// Department and section labels are looked up once and cached rather than re-queried
// per row, which is what made the naive version quadratic-feeling on large imports.
func (s *SQLite) BulkAdd(ctx context.Context, items []Item, source string) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	now := time.Now().UnixMilli()
	var first, last int64

	err := s.tx(ctx, func(tx *sql.Tx) error {
		labels, err := loadLabels(ctx, tx)
		if err != nil {
			return err
		}
		ins, err := tx.PrepareContext(ctx,
			`INSERT INTO items(name,norm,bin,qty,min,value,pkg,part,supplier,source,link,notes,created_at,updated_at)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
		if err != nil {
			return err
		}
		defer ins.Close()

		// The CID is part of the searchable text, and SQLite hands it out only on
		// insert. Reserving the block up front lets each row be written once instead
		// of inserted and then updated.
		var next int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(cid),0)+1 FROM items`).Scan(&next); err != nil {
			return err
		}
		first = next

		for _, it := range items {
			it.CID = next
			hay := Norm(strings.Join([]string{
				it.Name, it.Value, it.Pkg, it.Part, it.Notes,
				fmt.Sprintf("bin %d", it.Bin), CIDStr(it.CID),
				labels[fmt.Sprintf("d%d", it.Dept())],
				labels[fmt.Sprintf("%d%d", it.Dept(), it.Section())],
			}, " "))
			if _, err := ins.ExecContext(ctx, it.Name, hay, it.Bin, it.Qty, it.Min,
				it.Value, it.Pkg, it.Part, it.Supplier, it.Source, it.Link, it.Notes,
				now, now); err != nil {
				return err
			}
			next++
		}
		last = next - 1

		undo, _ := json.Marshal(map[string]any{"from": first, "to": last})
		return appendLog(ctx, tx, "import",
			fmt.Sprintf("imported %d items (%s)", len(items), source), nil, string(undo))
	})
	if err != nil {
		return 0, err
	}
	return len(items), nil
}

// loadLabels reads every department and section label in two queries so a bulk insert
// does not hit the database once per row just to build search text.
func loadLabels(ctx context.Context, q queryer) (map[string]string, error) {
	out := make(map[string]string, 48)

	rows, err := q.QueryContext(ctx, `SELECT n, label FROM depts`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var n int
		var label string
		if err := rows.Scan(&n, &label); err != nil {
			rows.Close()
			return nil, err
		}
		out[fmt.Sprintf("d%d", n)] = label
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = q.QueryContext(ctx, `SELECT code, label FROM sections`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var code, label string
		if err := rows.Scan(&code, &label); err != nil {
			return nil, err
		}
		out[code] = label
	}
	return out, rows.Err()
}

// patchable lists the columns a PATCH may touch. Anything else is rejected rather
// than silently ignored, so a typo in a client never quietly drops an edit.
var patchable = map[string]bool{
	"name": true, "bin": true, "qty": true, "min": true, "value": true, "pkg": true,
	"part": true, "supplier": true, "source": true, "link": true, "notes": true,
}

// UpdateItem applies a partial edit and records the before-state for undo.
func (s *SQLite) UpdateItem(ctx context.Context, cid int64, patch map[string]any) (Item, error) {
	var out Item
	err := s.tx(ctx, func(tx *sql.Tx) error {
		before, err := scanItem(tx.QueryRowContext(ctx, `SELECT `+itemCols+` FROM items WHERE cid=?`, cid))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}

		// Sort the column names FIRST, then build the SET list and its arguments in
		// that same order — a map iterates randomly, and sorting the SQL fragments
		// afterwards would silently pair each column with the wrong value.
		cols := make([]string, 0, len(patch))
		for col := range patch {
			if !patchable[col] {
				return fmt.Errorf("field %q is not editable", col)
			}
			cols = append(cols, col)
		}
		if len(cols) == 0 {
			out = before
			return nil
		}
		sort.Strings(cols) // stable SQL text keeps the statement cache effective

		sets := make([]string, 0, len(cols)+1)
		args := make([]any, 0, len(cols)+2)
		for _, col := range cols {
			sets = append(sets, col+"=?")
			args = append(args, patch[col])
		}
		sets = append(sets, "updated_at=?")
		args = append(args, time.Now().UnixMilli(), cid)

		if _, err := tx.ExecContext(ctx,
			`UPDATE items SET `+strings.Join(sets, ",")+` WHERE cid=?`, args...); err != nil {
			return err
		}
		if out, err = scanItem(tx.QueryRowContext(ctx, `SELECT `+itemCols+` FROM items WHERE cid=?`, cid)); err != nil {
			return err
		}
		hay, err := s.haystack(ctx, tx, out)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, cid); err != nil {
			return err
		}
		undo, _ := json.Marshal(map[string]any{"cid": cid, "before": before})
		return appendLog(ctx, tx, "edit", "edited "+CIDStr(cid)+" "+out.Name, &cid, string(undo))
	})
	return out, err
}

// DeleteItem removes an item, stashing the whole row in the undo payload so a
// mis-delete restores with its CID intact — the label on the drawer stays valid.
func (s *SQLite) DeleteItem(ctx context.Context, cid int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		before, err := scanItem(tx.QueryRowContext(ctx, `SELECT `+itemCols+` FROM items WHERE cid=?`, cid))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM items WHERE cid=?`, cid); err != nil {
			return err
		}
		undo, _ := json.Marshal(map[string]any{"cid": cid, "item": before})
		return appendLog(ctx, tx, "del", "deleted "+CIDStr(cid)+" "+before.Name, &cid, string(undo))
	})
}

// AdjustQty is take/stock as one atomic statement — the operation two tablets in the
// same shop are most likely to run at the same instant. Doing it as read-modify-write
// in Go would lose one of the two updates.
func (s *SQLite) AdjustQty(ctx context.Context, cid int64, delta int) (Item, error) {
	var out Item
	err := s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx,
			`UPDATE items SET qty = MAX(0, qty + ?), updated_at = ? WHERE cid = ?`,
			delta, time.Now().UnixMilli(), cid)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if out, err = scanItem(tx.QueryRowContext(ctx, `SELECT `+itemCols+` FROM items WHERE cid=?`, cid)); err != nil {
			return err
		}
		op, verb := "stock", "added"
		if delta < 0 {
			op, verb = "take", "took"
		}
		n := delta
		if n < 0 {
			n = -n
		}
		undo, _ := json.Marshal(map[string]any{"cid": cid, "delta": delta})
		return appendLog(ctx, tx, op,
			fmt.Sprintf("%s %d %s (now %d)", verb, n, out.Name, out.Qty), &cid, string(undo))
	})
	return out, err
}

// NextFreeBin returns the next unused bin in a department/section, counting up from
// xx10. Accepting the suggestion is what keeps the whole Dewey system self-organizing.
func (s *SQLite) NextFreeBin(ctx context.Context, dept, sec int) (int, error) {
	base := dept*1000 + sec*100
	rows, err := s.db.QueryContext(ctx,
		`SELECT bin FROM items WHERE bin >= ? AND bin < ? ORDER BY bin`, base, base+100)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	taken := map[int]bool{}
	for rows.Next() {
		var b int
		if err := rows.Scan(&b); err != nil {
			return 0, err
		}
		taken[b] = true
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for b := base + 10; b < base+100; b++ {
		if !taken[b] {
			return b, nil
		}
	}
	return 0, fmt.Errorf("section %d%d is full", dept, sec)
}

// ── layout ──────────────────────────────────────────────────────────────────

// Depts lists the ten departments with live item and piece counts, aggregated by the
// database rather than by walking rows.
func (s *SQLite) Depts(ctx context.Context) ([]Dept, error) {
	// Reads the trigger-maintained counters (at most 100 rows) instead of aggregating
	// the item table. This is what keeps the home screen instant at any inventory size.
	rows, err := s.db.QueryContext(ctx, `
		SELECT d.n, d.label,
		       COALESCE(SUM(c.items), 0), COALESCE(SUM(c.qty), 0)
		  FROM depts d
		  LEFT JOIN shelf_counts c ON c.dept = d.n
		 GROUP BY d.n, d.label
		 ORDER BY d.n`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Dept, 0, 10)
	for rows.Next() {
		var d Dept
		if err := rows.Scan(&d.N, &d.Label, &d.Items, &d.Qty); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Sections lists the shelves in one department, or all of them when dept < 0.
func (s *SQLite) Sections(ctx context.Context, dept int) ([]Section, error) {
	// Same counter table as Depts — a direct key lookup per shelf.
	q := `SELECT s.code, s.dept, s.digit, s.label, COALESCE(c.items, 0)
	        FROM sections s
	        LEFT JOIN shelf_counts c ON c.dept = s.dept AND c.digit = s.digit`
	var args []any
	if dept >= 0 {
		q += ` WHERE s.dept = ?`
		args = append(args, dept)
	}
	q += ` ORDER BY s.code`

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Section{}
	for rows.Next() {
		var sec Section
		if err := rows.Scan(&sec.Code, &sec.Dept, &sec.Digit, &sec.Label, &sec.Items); err != nil {
			return nil, err
		}
		out = append(out, sec)
	}
	return out, rows.Err()
}

// SetDept renames a department and refreshes the search text of everything on it.
func (s *SQLite) SetDept(ctx context.Context, n int, label string) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO depts(n,label) VALUES(?,?)
			 ON CONFLICT(n) DO UPDATE SET label=excluded.label`, n, label); err != nil {
			return err
		}
		if err := s.reindexDept(ctx, tx, n); err != nil {
			return err
		}
		return appendLog(ctx, tx, "dept", fmt.Sprintf("renamed department %d to %s", n, label), nil, "")
	})
}

// SetSection renames a shelf. An empty label clears it, which is refused while the
// shelf still holds items — the user is told to move them first.
func (s *SQLite) SetSection(ctx context.Context, code, label string) error {
	if len(code) != 2 || code[0] < '0' || code[0] > '9' || code[1] < '0' || code[1] > '9' {
		return fmt.Errorf("section code must be two digits, got %q", code)
	}
	dept, digit := int(code[0]-'0'), int(code[1]-'0')

	return s.tx(ctx, func(tx *sql.Tx) error {
		if label == "" {
			var n int
			if err := tx.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM items WHERE bin / 1000 = ? AND (bin / 100) % 10 = ?`,
				dept, digit).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				return fmt.Errorf("section %s still holds %d items — move or remove them first", code, n)
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM sections WHERE code=?`, code); err != nil {
				return err
			}
			return appendLog(ctx, tx, "section", "cleared section "+code, nil, "")
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO sections(code,dept,digit,label) VALUES(?,?,?,?)
			 ON CONFLICT(code) DO UPDATE SET label=excluded.label`,
			code, dept, digit, label); err != nil {
			return err
		}
		if err := s.reindexDept(ctx, tx, dept); err != nil {
			return err
		}
		return appendLog(ctx, tx, "section", "renamed section "+code+" to "+label, nil, "")
	})
}

// reindexDept rebuilds the search haystack for every item in a department, which is
// needed whenever a department or shelf label changes.
func (s *SQLite) reindexDept(ctx context.Context, tx *sql.Tx, dept int) error {
	rows, err := tx.QueryContext(ctx, `SELECT `+itemCols+` FROM items WHERE bin / 1000 = ?`, dept)
	if err != nil {
		return err
	}
	var items []Item
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			rows.Close()
			return err
		}
		items = append(items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, it := range items {
		hay, err := s.haystack(ctx, tx, it)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, it.CID); err != nil {
			return err
		}
	}
	return nil
}

// ── projects ────────────────────────────────────────────────────────────────

const projCols = `p.pid, p.name, p.notes, p.status, p.created_at, p.active`

func scanProject(sc interface{ Scan(...any) error }) (Project, error) {
	var p Project
	err := sc.Scan(&p.PID, &p.Name, &p.Notes, &p.Status, &p.CreatedAt, &p.Active, &p.Parts)
	return p, err
}

// Projects lists builds with their BOM line counts.
func (s *SQLite) Projects(ctx context.Context) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+projCols+`, COALESCE(COUNT(b.cid), 0)
		  FROM projects p
		  LEFT JOIN bom b ON b.pid = p.pid
		 GROUP BY p.pid, p.name, p.notes, p.status, p.created_at, p.active
		 ORDER BY p.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Project fetches one build.
func (s *SQLite) Project(ctx context.Context, pid int64) (Project, error) {
	p, err := scanProject(s.db.QueryRowContext(ctx, `
		SELECT `+projCols+`, COALESCE(COUNT(b.cid), 0)
		  FROM projects p LEFT JOIN bom b ON b.pid = p.pid
		 WHERE p.pid = ?
		 GROUP BY p.pid, p.name, p.notes, p.status, p.created_at, p.active`, pid))
	if errors.Is(err, sql.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	return p, err
}

// AddProject starts a new build.
func (s *SQLite) AddProject(ctx context.Context, name string) (Project, error) {
	var p Project
	err := s.tx(ctx, func(tx *sql.Tx) error {
		now := time.Now().UnixMilli()
		res, err := tx.ExecContext(ctx,
			`INSERT INTO projects(name, created_at) VALUES(?,?)`, name, now)
		if err != nil {
			return err
		}
		pid, err := res.LastInsertId()
		if err != nil {
			return err
		}
		p = Project{PID: pid, Name: name, Status: "planning", CreatedAt: now}
		undo, _ := json.Marshal(map[string]any{"pid": pid})
		return appendLog(ctx, tx, "proj.add", "started project "+name, nil, string(undo))
	})
	return p, err
}

var projPatchable = map[string]bool{"name": true, "notes": true, "status": true}

// UpdateProject edits a build's fields, recording the before-state for undo.
func (s *SQLite) UpdateProject(ctx context.Context, pid int64, patch map[string]any) (Project, error) {
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var before Project
		err := tx.QueryRowContext(ctx,
			`SELECT pid, name, notes, status FROM projects WHERE pid=?`, pid).
			Scan(&before.PID, &before.Name, &before.Notes, &before.Status)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		cols := make([]string, 0, len(patch))
		for col := range patch {
			if !projPatchable[col] {
				return fmt.Errorf("field %q is not editable on a project", col)
			}
			cols = append(cols, col)
		}
		if len(cols) == 0 {
			return nil
		}
		sort.Strings(cols) // columns and their values must be ordered together
		sets := make([]string, 0, len(cols))
		args := make([]any, 0, len(cols)+1)
		for _, c := range cols {
			sets = append(sets, c+"=?")
			args = append(args, patch[c])
		}
		args = append(args, pid)
		if _, err := tx.ExecContext(ctx,
			`UPDATE projects SET `+strings.Join(sets, ",")+` WHERE pid=?`, args...); err != nil {
			return err
		}
		undo, _ := json.Marshal(map[string]any{"pid": pid, "projBefore": before})
		return appendLog(ctx, tx, "proj.edit", "edited project "+before.Name, nil, string(undo))
	})
	if err != nil {
		return Project{}, err
	}
	return s.Project(ctx, pid)
}

// DeleteProject removes a build and its BOM lines. The lines go with it through the
// foreign key, and the whole thing is stashed so undo can put it back.
func (s *SQLite) DeleteProject(ctx context.Context, pid int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var p Project
		err := tx.QueryRowContext(ctx,
			`SELECT pid, name, notes, status, created_at FROM projects WHERE pid=?`, pid).
			Scan(&p.PID, &p.Name, &p.Notes, &p.Status, &p.CreatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT cid, qty FROM bom WHERE pid=?`, pid)
		if err != nil {
			return err
		}
		var lines []bomSnapshot
		for rows.Next() {
			var l bomSnapshot
			if err := rows.Scan(&l.CID, &l.Qty); err != nil {
				rows.Close()
				return err
			}
			lines = append(lines, l)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM projects WHERE pid=?`, pid); err != nil {
			return err
		}
		undo, _ := json.Marshal(map[string]any{"projGone": p, "bomGone": lines})
		return appendLog(ctx, tx, "proj.del", "deleted project "+p.Name, nil, string(undo))
	})
}

// bomSnapshot is one stashed BOM line, used to restore a deleted project.
type bomSnapshot struct {
	CID int64 `json:"cid"`
	Qty int   `json:"qty"`
}

// SetActiveProject marks one build active and clears the rest. Exactly one project is
// active at a time, which is what the graph and the build flow key off.
func (s *SQLite) SetActiveProject(ctx context.Context, pid int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE projects SET active=0 WHERE active=1`); err != nil {
			return err
		}
		if pid <= 0 {
			return nil
		}
		res, err := tx.ExecContext(ctx, `UPDATE projects SET active=1 WHERE pid=?`, pid)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// SetBomLine adds a part to a build, or changes how many the build needs.
func (s *SQLite) SetBomLine(ctx context.Context, pid, cid int64, need int) error {
	if need < 1 {
		return fmt.Errorf("a BOM line needs at least 1")
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		var before int
		err := tx.QueryRowContext(ctx, `SELECT qty FROM bom WHERE pid=? AND cid=?`, pid, cid).Scan(&before)
		existed := err == nil
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO bom(pid,cid,qty) VALUES(?,?,?)
			 ON CONFLICT(pid,cid) DO UPDATE SET qty=excluded.qty`, pid, cid, need); err != nil {
			return err
		}
		var name string
		tx.QueryRowContext(ctx, `SELECT name FROM items WHERE cid=?`, cid).Scan(&name)
		verb := "added"
		if existed {
			verb = "changed to"
		}
		undo, _ := json.Marshal(map[string]any{
			"pid": pid, "cid": cid, "bomBefore": before, "bomExisted": existed})
		return appendLog(ctx, tx, "bom.set",
			fmt.Sprintf("%s %d x %s in the build", verb, need, name), &cid, string(undo))
	})
}

// RemoveBomLine drops a part from a build.
func (s *SQLite) RemoveBomLine(ctx context.Context, pid, cid int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var before int
		err := tx.QueryRowContext(ctx, `SELECT qty FROM bom WHERE pid=? AND cid=?`, pid, cid).Scan(&before)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM bom WHERE pid=? AND cid=?`, pid, cid); err != nil {
			return err
		}
		var name string
		tx.QueryRowContext(ctx, `SELECT name FROM items WHERE cid=?`, cid).Scan(&name)
		undo, _ := json.Marshal(map[string]any{
			"pid": pid, "cid": cid, "bomBefore": before, "bomExisted": true, "bomRemoved": true})
		return appendLog(ctx, tx, "bom.del", "removed "+name+" from the build", &cid, string(undo))
	})
}

// SharedParts reports every item used by more than one project, with the projects using
// it. The galaxy view draws these as the bridges between clusters, and computing it in
// SQL avoids pulling every BOM into the browser to intersect them there.
func (s *SQLite) SharedParts(ctx context.Context) ([]SharedPart, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT b.cid, i.name, i.bin, b.pid
		  FROM bom b
		  JOIN items i ON i.cid = b.cid
		 WHERE b.cid IN (SELECT cid FROM bom GROUP BY cid HAVING COUNT(DISTINCT pid) > 1)
		 ORDER BY b.cid, b.pid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SharedPart{}
	for rows.Next() {
		var (
			cid  int64
			name string
			bin  int
			pid  int64
		)
		if err := rows.Scan(&cid, &name, &bin, &pid); err != nil {
			return nil, err
		}
		if n := len(out); n > 0 && out[n-1].CID == cid {
			out[n-1].Projects = append(out[n-1].Projects, pid)
			continue
		}
		out = append(out, SharedPart{CID: cid, Name: name, Bin: bin, Projects: []int64{pid}})
	}
	return out, rows.Err()
}

// Bom returns a project's part list joined against current stock, so the UI can show
// "need 4, have 2" without a second round trip per line.
//
// Like the other list methods here it returns an empty slice rather than nil, so the
// JSON layer emits [] and clients never have to guard against null.
func (s *SQLite) Bom(ctx context.Context, pid int64) ([]BomLine, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT b.pid, b.cid, i.name, i.bin, b.qty, i.qty, i.min
		  FROM bom b
		  JOIN items i ON i.cid = b.cid
		 WHERE b.pid = ?
		 ORDER BY i.bin, i.name COLLATE NOCASE`, pid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []BomLine{}
	for rows.Next() {
		var l BomLine
		if err := rows.Scan(&l.PID, &l.CID, &l.Name, &l.Bin, &l.Need, &l.Have, &l.Min); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ── log / undo ──────────────────────────────────────────────────────────────

func appendLog(ctx context.Context, tx *sql.Tx, op, text string, cid *int64, undo string) error {
	var u any
	if undo != "" {
		u = undo
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO log(ts,op,text,cid,undo) VALUES(?,?,?,?,?)`,
		time.Now().UnixMilli(), op, text, cid, u)
	return err
}

// Log returns one page of activity, newest first.
func (s *SQLite) Log(ctx context.Context, limit, offset int) (Page[LogEntry], error) {
	var page Page[LogEntry]
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM log`).Scan(&page.Total); err != nil {
		return page, err
	}
	if limit <= 0 || limit > MaxLimit {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, ts, op, text, cid, operator, undo IS NOT NULL, undone
		   FROM log ORDER BY id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return page, err
	}
	defer rows.Close()

	for rows.Next() {
		var e LogEntry
		if err := rows.Scan(&e.ID, &e.TS, &e.Op, &e.Text, &e.CID, &e.Operator, &e.Undoable, &e.Undone); err != nil {
			return page, err
		}
		page.Rows = append(page.Rows, e)
	}
	return page, rows.Err()
}

// Undo reverses the most recent reversible mutation and marks it undone. Repeat to
// walk further back. Every op that writes must have a case here — a missing one is a
// silent data-loss bug, which is why the default arm is a hard error.
func (s *SQLite) Undo(ctx context.Context) (LogEntry, error) {
	var e LogEntry
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var payload string
		err := tx.QueryRowContext(ctx,
			`SELECT id, ts, op, text, cid, undo FROM log
			  WHERE undo IS NOT NULL AND undone = 0
			  ORDER BY id DESC LIMIT 1`).
			Scan(&e.ID, &e.TS, &e.Op, &e.Text, &e.CID, &payload)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}

		var p struct {
			CID    int64 `json:"cid"`
			Delta  int   `json:"delta"`
			Item   *Item `json:"item"`
			Before *Item `json:"before"`
			From   int64 `json:"from"`
			To     int64 `json:"to"`

			BuildTook []struct {
				CID int64 `json:"cid"`
				Qty int   `json:"qty"`
			} `json:"buildTook"`
			BuildStatus string `json:"buildStatus"`

			CountBefore     int              `json:"countBefore"`
			BulkBefore      []Item           `json:"bulkBefore"`
			MergeKeepBefore *Item            `json:"mergeKeepBefore"`
			MergeBom        []map[string]any `json:"mergeBom"`

			PID        int64         `json:"pid"`
			ProjBefore *Project      `json:"projBefore"`
			ProjGone   *Project      `json:"projGone"`
			BomGone    []bomSnapshot `json:"bomGone"`
			BomBefore  int           `json:"bomBefore"`
			BomExisted bool          `json:"bomExisted"`
			BomRemoved bool          `json:"bomRemoved"`
		}
		if err := json.Unmarshal([]byte(payload), &p); err != nil {
			return fmt.Errorf("undo payload for log %d is unreadable: %w", e.ID, err)
		}

		switch e.Op {
		case "add":
			_, err = tx.ExecContext(ctx, `DELETE FROM items WHERE cid=?`, p.CID)
		case "del":
			if p.Item == nil {
				return fmt.Errorf("undo payload for log %d has no item", e.ID)
			}
			it := *p.Item
			// re-inserts with the ORIGINAL cid: the drawer label still points here
			_, err = tx.ExecContext(ctx,
				`INSERT INTO items(cid,name,norm,bin,qty,min,value,pkg,part,supplier,source,link,notes,created_at,updated_at)
				 VALUES(?,?,'',?,?,?,?,?,?,?,?,?,?,?,?)`,
				it.CID, it.Name, it.Bin, it.Qty, it.Min, it.Value, it.Pkg, it.Part,
				it.Supplier, it.Source, it.Link, it.Notes, it.CreatedAt, time.Now().UnixMilli())
			if err == nil {
				var hay string
				if hay, err = s.haystack(ctx, tx, it); err == nil {
					_, err = tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, it.CID)
				}
			}
		case "build":
			// put every part back and restore the status the project had before
			for _, b := range p.BuildTook {
				if err != nil {
					break
				}
				_, err = tx.ExecContext(ctx,
					`UPDATE items SET qty = qty + ?, updated_at = ? WHERE cid = ?`,
					b.Qty, time.Now().UnixMilli(), b.CID)
			}
			if err == nil && p.BuildStatus != "" {
				_, err = tx.ExecContext(ctx,
					`UPDATE projects SET status=? WHERE pid=?`, p.BuildStatus, p.PID)
			}
		case "count":
			// put the quantity back to what the system believed before the count
			_, err = tx.ExecContext(ctx,
				`UPDATE items SET qty=?, updated_at=? WHERE cid=?`,
				p.CountBefore, time.Now().UnixMilli(), p.CID)
		case "bulk":
			// every row the batch touched goes back to its own before-state
			for _, b := range p.BulkBefore {
				if err != nil {
					break
				}
				_, err = tx.ExecContext(ctx,
					`UPDATE items SET name=?,bin=?,qty=?,min=?,value=?,pkg=?,part=?,
					        supplier=?,source=?,link=?,notes=?,updated_at=? WHERE cid=?`,
					b.Name, b.Bin, b.Qty, b.Min, b.Value, b.Pkg, b.Part,
					b.Supplier, b.Source, b.Link, b.Notes, time.Now().UnixMilli(), b.CID)
				if err == nil {
					var hay string
					if hay, err = s.haystack(ctx, tx, b); err == nil {
						_, err = tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, b.CID)
					}
				}
			}
		case "merge":
			// restore the survivor's own fields, bring the duplicate back with its
			// original cid, and hand its BOM lines back
			if p.MergeKeepBefore == nil || p.Item == nil {
				return fmt.Errorf("undo payload for log %d is incomplete", e.ID)
			}
			k := *p.MergeKeepBefore
			d := *p.Item
			_, err = tx.ExecContext(ctx,
				`UPDATE items SET qty=?,min=?,value=?,pkg=?,part=?,supplier=?,source=?,link=?,notes=?,updated_at=?
				 WHERE cid=?`,
				k.Qty, k.Min, k.Value, k.Pkg, k.Part, k.Supplier, k.Source, k.Link, k.Notes,
				time.Now().UnixMilli(), k.CID)
			if err == nil {
				_, err = tx.ExecContext(ctx,
					`INSERT INTO items(cid,name,norm,bin,qty,min,value,pkg,part,supplier,source,link,notes,created_at,updated_at)
					 VALUES(?,?,'',?,?,?,?,?,?,?,?,?,?,?,?)`,
					d.CID, d.Name, d.Bin, d.Qty, d.Min, d.Value, d.Pkg, d.Part,
					d.Supplier, d.Source, d.Link, d.Notes, d.CreatedAt, time.Now().UnixMilli())
			}
			if err == nil {
				var hay string
				if hay, err = s.haystack(ctx, tx, d); err == nil {
					_, err = tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, d.CID)
				}
			}
			for _, bl := range p.MergeBom {
				if err != nil {
					break
				}
				pid, okp := toInt64(bl["pid"])
				qty, okq := toInt64(bl["qty"])
				if !okp || !okq {
					continue
				}
				if _, err = tx.ExecContext(ctx,
					`INSERT INTO bom(pid,cid,qty) VALUES(?,?,?)
					 ON CONFLICT(pid,cid) DO UPDATE SET qty=excluded.qty`, pid, d.CID, qty); err == nil {
					_, err = tx.ExecContext(ctx, `DELETE FROM bom WHERE pid=? AND cid=?`, pid, k.CID)
				}
			}
		case "proj.add":
			_, err = tx.ExecContext(ctx, `DELETE FROM projects WHERE pid=?`, p.PID)
		case "proj.edit":
			if p.ProjBefore == nil {
				return fmt.Errorf("undo payload for log %d has no project before-state", e.ID)
			}
			b := *p.ProjBefore
			_, err = tx.ExecContext(ctx,
				`UPDATE projects SET name=?, notes=?, status=? WHERE pid=?`,
				b.Name, b.Notes, b.Status, b.PID)
		case "proj.del":
			if p.ProjGone == nil {
				return fmt.Errorf("undo payload for log %d has no project", e.ID)
			}
			g := *p.ProjGone
			// restored with its ORIGINAL pid so its BOM lines still point at it
			_, err = tx.ExecContext(ctx,
				`INSERT INTO projects(pid,name,notes,status,created_at) VALUES(?,?,?,?,?)`,
				g.PID, g.Name, g.Notes, g.Status, g.CreatedAt)
			for _, l := range p.BomGone {
				if err != nil {
					break
				}
				_, err = tx.ExecContext(ctx,
					`INSERT INTO bom(pid,cid,qty) VALUES(?,?,?)`, g.PID, l.CID, l.Qty)
			}
		case "bom.set":
			if p.BomExisted {
				_, err = tx.ExecContext(ctx,
					`UPDATE bom SET qty=? WHERE pid=? AND cid=?`, p.BomBefore, p.PID, p.CID)
			} else {
				_, err = tx.ExecContext(ctx, `DELETE FROM bom WHERE pid=? AND cid=?`, p.PID, p.CID)
			}
		case "bom.del":
			_, err = tx.ExecContext(ctx,
				`INSERT INTO bom(pid,cid,qty) VALUES(?,?,?)
				 ON CONFLICT(pid,cid) DO UPDATE SET qty=excluded.qty`, p.PID, p.CID, p.BomBefore)
		case "import":
			// a whole import backs out as one step, by the CID block it was given
			_, err = tx.ExecContext(ctx, `DELETE FROM items WHERE cid BETWEEN ? AND ?`, p.From, p.To)
		case "take", "stock":
			_, err = tx.ExecContext(ctx,
				`UPDATE items SET qty = MAX(0, qty - ?), updated_at = ? WHERE cid = ?`,
				p.Delta, time.Now().UnixMilli(), p.CID)
		case "edit":
			if p.Before == nil {
				return fmt.Errorf("undo payload for log %d has no before-state", e.ID)
			}
			b := *p.Before
			_, err = tx.ExecContext(ctx,
				`UPDATE items SET name=?,bin=?,qty=?,min=?,value=?,pkg=?,part=?,
				        supplier=?,source=?,link=?,notes=?,updated_at=? WHERE cid=?`,
				b.Name, b.Bin, b.Qty, b.Min, b.Value, b.Pkg, b.Part,
				b.Supplier, b.Source, b.Link, b.Notes, time.Now().UnixMilli(), b.CID)
			if err == nil {
				var hay string
				if hay, err = s.haystack(ctx, tx, b); err == nil {
					_, err = tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, b.CID)
				}
			}
		default:
			return fmt.Errorf("no undo handler for op %q (log %d)", e.Op, e.ID)
		}
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE log SET undone=1 WHERE id=?`, e.ID)
		return err
	})
	return e, err
}

// toInt64 reads a number back out of a decoded JSON payload, where every number
// arrives as a float64.
func toInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case int64:
		return n, true
	}
	return 0, false
}

// ── misc ────────────────────────────────────────────────────────────────────

// Stats is the home summary, computed entirely by aggregate queries.
func (s *SQLite) Stats(ctx context.Context) (Stats, error) {
	var st Stats
	// Item and piece totals come from the counter table; only the distinct-bin count
	// needs the item index, and the low count is served by its partial index. None of
	// the three touches a full row.
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(items),0), COALESCE(SUM(qty),0) FROM shelf_counts`).
		Scan(&st.Items, &st.Pieces)
	if err != nil {
		return st, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM (SELECT DISTINCT bin FROM items)`).Scan(&st.Bins); err != nil {
		return st, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM items WHERE qty <= min`).Scan(&st.Low); err != nil {
		return st, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM projects`).Scan(&st.Projects); err != nil {
		return st, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM log`).Scan(&st.LogSize); err != nil {
		return st, err
	}
	// In WAL mode recent writes live in the -wal sidecar until a checkpoint, so the
	// main file alone under-reports how much disk the shop's data actually occupies.
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if fi, err := os.Stat(s.path + suffix); err == nil {
			st.DBBytes += fi.Size()
		}
	}
	return st, nil
}

// Meta reads a shop-level setting. A missing key is an empty string, not an error.
func (s *SQLite) Meta(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key=?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// SetMeta writes a shop-level setting.
func (s *SQLite) SetMeta(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO meta(key,value) VALUES(?,?)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// compile-time proof that SQLite satisfies the contract the SaaS build also targets
var _ Store = (*SQLite)(nil)
