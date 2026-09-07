package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ── cycle count ─────────────────────────────────────────────────────────────

// RecordCount books the result of physically counting a bin. It writes the corrected
// quantity, stamps the item as counted, and keeps the discrepancy in the count history
// — all in one transaction, so a count can never be half-recorded.
//
// A count that MATCHES is still recorded. "We checked and it was right" is exactly the
// evidence an audit trail exists to provide.
func (s *SQLite) RecordCount(ctx context.Context, cid int64, actual int, scope string) (Item, error) {
	if actual < 0 {
		return Item{}, fmt.Errorf("a counted quantity cannot be negative")
	}
	var out Item
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var expected int
		var name string
		err := tx.QueryRowContext(ctx, `SELECT qty, name FROM items WHERE cid=?`, cid).
			Scan(&expected, &name)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		now := time.Now().UnixMilli()
		if _, err := tx.ExecContext(ctx,
			`UPDATE items SET qty=?, counted_at=?, updated_at=? WHERE cid=?`,
			actual, now, now, cid); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO countlog(ts,cid,expected,actual,scope) VALUES(?,?,?,?,?)`,
			now, cid, expected, actual, scope); err != nil {
			return err
		}
		text := fmt.Sprintf("counted %s: %d (was %d)", name, actual, expected)
		if actual == expected {
			text = fmt.Sprintf("counted %s: %d, matched", name, actual)
		}
		undo, _ := json.Marshal(map[string]any{"cid": cid, "countBefore": expected})
		return appendLog(ctx, tx, "count", text, &cid, string(undo))
	})
	if err != nil {
		return out, err
	}
	return s.Item(ctx, cid)
}

// CountLog returns the most recent count results, newest first.
func (s *SQLite) CountLog(ctx context.Context, limit int) ([]CountEntry, error) {
	if limit <= 0 || limit > MaxLimit {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.ts, c.cid, COALESCE(i.name,'(deleted)'), c.expected, c.actual, c.scope
		  FROM countlog c
		  LEFT JOIN items i ON i.cid = c.cid
		 ORDER BY c.id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CountEntry{}
	for rows.Next() {
		var e CountEntry
		if err := rows.Scan(&e.ID, &e.TS, &e.CID, &e.Name, &e.Expected, &e.Actual, &e.Scope); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── photos ──────────────────────────────────────────────────────────────────

// SetPhoto stores (or replaces) the picture attached to an item. Photos live in their
// own table so listing items never drags image bytes through memory.
func (s *SQLite) SetPhoto(ctx context.Context, cid int64, mime string, data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("empty photo")
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM items WHERE cid=?`, cid).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return ErrNotFound
	}
	if mime == "" {
		mime = "image/jpeg"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO photos(cid, mime, data, added_at) VALUES(?,?,?,?)
		 ON CONFLICT(cid) DO UPDATE SET mime=excluded.mime, data=excluded.data, added_at=excluded.added_at`,
		cid, mime, data, time.Now().UnixMilli())
	return err
}

// Photo returns one item's picture.
func (s *SQLite) Photo(ctx context.Context, cid int64) (string, []byte, error) {
	var mime string
	var data []byte
	err := s.db.QueryRowContext(ctx, `SELECT mime, data FROM photos WHERE cid=?`, cid).Scan(&mime, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, ErrNotFound
	}
	return mime, data, err
}

// DeletePhoto removes an item's picture.
func (s *SQLite) DeletePhoto(ctx context.Context, cid int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM photos WHERE cid=?`, cid)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// PhotoIDs lists which items have a picture. The UI uses it to flag rows, and asking
// for the id list is far cheaper than probing each item or joining image bytes into
// every listing.
func (s *SQLite) PhotoIDs(ctx context.Context) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT cid FROM photos ORDER BY cid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []int64{}
	for rows.Next() {
		var cid int64
		if err := rows.Scan(&cid); err != nil {
			return nil, err
		}
		out = append(out, cid)
	}
	return out, rows.Err()
}

// ── bulk maintenance ────────────────────────────────────────────────────────

// BulkUpdate applies many edits in one transaction and records them as ONE log entry.
//
// This is what `tidy apply` and the doctor's repairs run through: renaming 400 items
// has to be a single undoable action, not 400 of them, or backing the change out means
// pressing undo 400 times.
func (s *SQLite) BulkUpdate(ctx context.Context, patches []ItemPatch, what string) (int, error) {
	if len(patches) == 0 {
		return 0, nil
	}
	changed := 0
	err := s.tx(ctx, func(tx *sql.Tx) error {
		before := make([]Item, 0, len(patches))
		now := time.Now().UnixMilli()

		for _, p := range patches {
			cur, err := scanItem(tx.QueryRowContext(ctx,
				`SELECT `+itemCols+` FROM items WHERE cid=?`, p.CID))
			if errors.Is(err, sql.ErrNoRows) {
				continue // an item deleted since the scan is not an error, just skip it
			} else if err != nil {
				return err
			}

			cols := make([]string, 0, len(p.Patch))
			for col := range p.Patch {
				if !patchable[col] {
					return fmt.Errorf("field %q is not editable", col)
				}
				cols = append(cols, col)
			}
			if len(cols) == 0 {
				continue
			}
			sort.Strings(cols) // columns and values must stay paired
			sets := make([]string, 0, len(cols)+1)
			args := make([]any, 0, len(cols)+2)
			for _, c := range cols {
				sets = append(sets, c+"=?")
				args = append(args, p.Patch[c])
			}
			sets = append(sets, "updated_at=?")
			args = append(args, now, p.CID)

			if _, err := tx.ExecContext(ctx,
				`UPDATE items SET `+strings.Join(sets, ",")+` WHERE cid=?`, args...); err != nil {
				return err
			}
			after, err := scanItem(tx.QueryRowContext(ctx,
				`SELECT `+itemCols+` FROM items WHERE cid=?`, p.CID))
			if err != nil {
				return err
			}
			hay, err := s.haystack(ctx, tx, after)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, p.CID); err != nil {
				return err
			}
			before = append(before, cur)
			changed++
		}

		if changed == 0 {
			return nil
		}
		undo, _ := json.Marshal(map[string]any{"bulkBefore": before})
		return appendLog(ctx, tx, "bulk",
			fmt.Sprintf("%s — %d item%s", what, changed, plural(changed)), nil, string(undo))
	})
	return changed, err
}

// MergeItems folds a duplicate into the item being kept: their quantities add up, any
// empty field on the survivor is filled from the duplicate, every BOM line pointing at
// the duplicate is repointed, and the duplicate is removed. One transaction, one undo.
func (s *SQLite) MergeItems(ctx context.Context, keep, drop int64) error {
	if keep == drop {
		return fmt.Errorf("cannot merge an item into itself")
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		k, err := scanItem(tx.QueryRowContext(ctx, `SELECT `+itemCols+` FROM items WHERE cid=?`, keep))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		d, err := scanItem(tx.QueryRowContext(ctx, `SELECT `+itemCols+` FROM items WHERE cid=?`, drop))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}

		merged := k
		merged.Qty = k.Qty + d.Qty
		if merged.Min < d.Min {
			merged.Min = d.Min
		}
		// the survivor keeps what it has; blanks are filled from the duplicate
		fill := func(dst *string, src string) {
			if strings.TrimSpace(*dst) == "" {
				*dst = src
			}
		}
		fill(&merged.Value, d.Value)
		fill(&merged.Pkg, d.Pkg)
		fill(&merged.Part, d.Part)
		fill(&merged.Supplier, d.Supplier)
		fill(&merged.Source, d.Source)
		fill(&merged.Link, d.Link)
		if strings.TrimSpace(merged.Notes) == "" {
			merged.Notes = d.Notes
		} else if strings.TrimSpace(d.Notes) != "" && merged.Notes != d.Notes {
			merged.Notes = merged.Notes + " · " + d.Notes
		}

		now := time.Now().UnixMilli()
		if _, err := tx.ExecContext(ctx,
			`UPDATE items SET qty=?,min=?,value=?,pkg=?,part=?,supplier=?,source=?,link=?,notes=?,updated_at=?
			 WHERE cid=?`,
			merged.Qty, merged.Min, merged.Value, merged.Pkg, merged.Part,
			merged.Supplier, merged.Source, merged.Link, merged.Notes, now, keep); err != nil {
			return err
		}
		hay, err := s.haystack(ctx, tx, merged)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE items SET norm=? WHERE cid=?`, hay, keep); err != nil {
			return err
		}

		// Repoint BOM lines. A project that referenced BOTH keeps the larger need,
		// because the two lines are now the same part.
		var bomMoved []map[string]any
		rows, err := tx.QueryContext(ctx, `SELECT pid, qty FROM bom WHERE cid=?`, drop)
		if err != nil {
			return err
		}
		type line struct {
			pid int64
			qty int
		}
		var lines []line
		for rows.Next() {
			var l line
			if err := rows.Scan(&l.pid, &l.qty); err != nil {
				rows.Close()
				return err
			}
			lines = append(lines, l)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, l := range lines {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO bom(pid,cid,qty) VALUES(?,?,?)
				 ON CONFLICT(pid,cid) DO UPDATE SET qty=MAX(bom.qty, excluded.qty)`,
				l.pid, keep, l.qty); err != nil {
				return err
			}
			bomMoved = append(bomMoved, map[string]any{"pid": l.pid, "qty": l.qty})
		}

		if _, err := tx.ExecContext(ctx, `DELETE FROM items WHERE cid=?`, drop); err != nil {
			return err
		}
		undo, _ := json.Marshal(map[string]any{
			"mergeKeepBefore": k, "item": d, "cid": drop, "mergeBom": bomMoved,
		})
		return appendLog(ctx, tx, "merge",
			fmt.Sprintf("merged %s into %s (qty %d)", CIDStr(drop), CIDStr(keep), merged.Qty),
			&keep, string(undo))
	})
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// ── backup ──────────────────────────────────────────────────────────────────

// Backup writes a consistent copy of the entire database to destPath.
//
// It uses SQLite's own VACUUM INTO rather than copying the file, because copying a
// live database can catch it mid-write and produce a backup that will not open. This
// is safe to run while the shop is scanning and taking stock.
func (s *SQLite) Backup(ctx context.Context, destPath string) error {
	if _, err := s.db.ExecContext(ctx, `VACUUM INTO ?`, destPath); err != nil {
		return fmt.Errorf("backup to %s: %w", destPath, err)
	}
	return nil
}

// Path reports where the live database file lives.
func (s *SQLite) Path() string { return s.path }
