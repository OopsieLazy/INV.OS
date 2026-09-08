package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// LegacySnapshot is an inventory read out of an old v20.2 export, in this package's own
// types. internal/legacy fills it; nothing here knows about the old file format.
type LegacySnapshot struct {
	Items    []Item
	Projects []LegacyProject
	Depts    map[int]string
	Sections map[string]string
	// Skipped explains every row that was NOT carried over. An import that quietly
	// drops rows is worse than one that refuses, so this is reported, never discarded.
	Skipped []string
}

// LegacyProject is one project plus its BOM.
type LegacyProject struct {
	PID     int64
	Name    string
	Notes   string
	Status  string
	Created int64
	Active  bool
	Bom     []LegacyBom
}

type LegacyBom struct {
	CID  int64
	Need int
}

// LegacyResult is what an import actually did.
type LegacyResult struct {
	Items    int      `json:"items"`
	Projects int      `json:"projects"`
	BomLines int      `json:"bomLines"`
	Depts    int      `json:"depts"`
	Sections int      `json:"sections"`
	Skipped  []string `json:"skipped,omitempty"`
}

// LegacyBlob pulls the inventory JSON out of an old physical invos.db — the file the
// sql.js mirror wrote, whose whole contents were one blob in `state`.
//
// This is the only reason the package opens a database it does not own, and it is here
// rather than in internal/legacy because reading it is SQL, and SQL lives in this package.
// Opened read-only and with an immutable URI so a half-synced file cannot be modified by
// the act of looking at it.
func LegacyBlob(path string) (string, error) {
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&immutable=1")
	if err != nil {
		return "", err
	}
	defer db.Close()

	var blob string
	// The mirror wrote one row; later writers appended, so take the newest.
	err = db.QueryRow(`SELECT blob FROM state ORDER BY updated_at DESC LIMIT 1`).Scan(&blob)
	if err != nil {
		return "", fmt.Errorf("no inventory blob in %s (is this an old INV.OS database?): %w", path, err)
	}
	return blob, nil
}

// ImportLegacy writes a whole legacy inventory in ONE transaction and ONE log entry.
//
// Original C-IDs are preserved deliberately: a printed label stuck on a drawer points at
// a number, and an import that renumbered everything would silently invalidate every
// label in the shop. That is also why this refuses to run when a CID already exists here
// rather than merging or renumbering — two different drawers would end up claiming one
// number, and no automatic choice between them is safe.
func (s *SQLite) ImportLegacy(ctx context.Context, snap LegacySnapshot) (LegacyResult, error) {
	res := LegacyResult{Skipped: snap.Skipped}
	if len(snap.Items) == 0 && len(snap.Projects) == 0 {
		return res, fmt.Errorf("nothing to import")
	}
	now := time.Now().UnixMilli()

	err := s.tx(ctx, func(tx *sql.Tx) error {
		// Refuse before writing anything, and say exactly which numbers clash.
		var clash []string
		for _, it := range snap.Items {
			var n int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM items WHERE cid=?`, it.CID).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				clash = append(clash, CIDStr(it.CID))
				if len(clash) >= 5 {
					break
				}
			}
		}
		if len(clash) > 0 {
			return fmt.Errorf("this database already has %s — import into an empty inventory, "+
				"or back this one up and start fresh", strings.Join(clash, ", "))
		}

		// Department and shelf names first: the search text of every item embeds them,
		// so writing them afterwards would leave the first import unsearchable by
		// shelf name until something else touched the row.
		for n, label := range snap.Depts {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO depts(n,label) VALUES(?,?)
				 ON CONFLICT(n) DO UPDATE SET label=excluded.label`, n, label); err != nil {
				return err
			}
			res.Depts++
		}
		for code, label := range snap.Sections {
			// "11" means dept 1, shelf 1. The two digits are stored as their own columns
			// so a shelf can be filtered without pulling the code apart in SQL.
			if len(code) != 2 || code[0] < '0' || code[0] > '9' || code[1] < '0' || code[1] > '9' {
				res.Skipped = append(res.Skipped, fmt.Sprintf("shelf code %q is not two digits", code))
				continue
			}
			dept, digit := int(code[0]-'0'), int(code[1]-'0')
			// A shelf belongs to a department, and the schema enforces it. An export
			// naming a shelf in a department it never named gets the default label.
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO depts(n,label) VALUES(?,?) ON CONFLICT(n) DO NOTHING`,
				dept, defaultDeptLabel(dept)); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO sections(code,dept,digit,label) VALUES(?,?,?,?)
				 ON CONFLICT(code) DO UPDATE SET label=excluded.label`,
				code, dept, digit, label); err != nil {
				return err
			}
			res.Sections++
		}

		labels, err := loadLabels(ctx, tx)
		if err != nil {
			return err
		}
		ins, err := tx.PrepareContext(ctx,
			`INSERT INTO items(cid,name,norm,bin,qty,min,value,pkg,part,supplier,source,link,notes,
			                   created_at,updated_at,counted_at)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
		if err != nil {
			return err
		}
		defer ins.Close()

		var minCID, maxCID int64
		for _, it := range snap.Items {
			hay := Norm(strings.Join([]string{
				it.Name, it.Value, it.Pkg, it.Part, it.Notes,
				fmt.Sprintf("bin %d", it.Bin), CIDStr(it.CID),
				labels[fmt.Sprintf("d%d", it.Dept())],
				labels[fmt.Sprintf("%d%d", it.Dept(), it.Section())],
			}, " "))
			created := it.CreatedAt
			if created == 0 {
				created = now
			}
			if _, err := ins.ExecContext(ctx, it.CID, it.Name, hay, it.Bin, it.Qty, it.Min,
				it.Value, it.Pkg, it.Part, it.Supplier, it.Source, it.Link, it.Notes,
				created, now, it.CountedAt); err != nil {
				return err
			}
			if minCID == 0 || it.CID < minCID {
				minCID = it.CID
			}
			if it.CID > maxCID {
				maxCID = it.CID
			}
			res.Items++
		}

		for _, p := range snap.Projects {
			created := p.Created
			if created == 0 {
				created = now
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO projects(pid,name,notes,status,created_at,active) VALUES(?,?,?,?,?,?)`,
				p.PID, p.Name, p.Notes, p.Status, created, boolInt(p.Active)); err != nil {
				return fmt.Errorf("project %q: %w", p.Name, err)
			}
			res.Projects++
			for _, b := range p.Bom {
				if _, err := tx.ExecContext(ctx,
					`INSERT INTO bom(pid,cid,qty) VALUES(?,?,?)`, p.PID, b.CID, b.Need); err != nil {
					return fmt.Errorf("project %q BOM: %w", p.Name, err)
				}
				res.BomLines++
			}
		}

		/* AUTOINCREMENT hands out max(rowid)+1, so after inserting explicit CIDs the
		   next natural ID already follows the highest imported one. sqlite_sequence is
		   nudged anyway: if the import were ever run against a table whose sequence had
		   been pushed higher and then emptied, a later add could otherwise collide with
		   an imported number. IDs must never be reused. */
		if err := bumpSeq(ctx, tx, "items", maxCID); err != nil {
			return err
		}
		var maxPID int64
		for _, p := range snap.Projects {
			if p.PID > maxPID {
				maxPID = p.PID
			}
		}
		if err := bumpSeq(ctx, tx, "projects", maxPID); err != nil {
			return err
		}

		undo, _ := json.Marshal(map[string]any{"from": minCID, "to": maxCID})
		return appendLog(ctx, tx, "import.legacy",
			fmt.Sprintf("imported a v20.2 inventory: %d items, %d projects", res.Items, res.Projects),
			nil, string(undo))
	})
	if err != nil {
		return LegacyResult{Skipped: snap.Skipped}, err
	}
	return res, nil
}

func bumpSeq(ctx context.Context, tx *sql.Tx, table string, hi int64) error {
	if hi <= 0 {
		return nil
	}
	// sqlite_sequence is an internal table with no declared UNIQUE constraint, so
	// ON CONFLICT cannot target it. Update, and insert only if there was no row.
	r, err := tx.ExecContext(ctx,
		`UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?`, hi, table)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n > 0 {
		return nil
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)`, table, hi)
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// defaultDeptLabel names a department the export never named, so a shelf that belongs to
// it can still be written — the schema requires the parent row to exist.
func defaultDeptLabel(n int) string {
	if n >= 0 && n < len(DefaultDepts) {
		return DefaultDepts[n]
	}
	return fmt.Sprintf("DEPT %d", n)
}
