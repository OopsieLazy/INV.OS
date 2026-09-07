// Package store is the only place in INV.OS that touches a database.
//
// Everything above it (HTTP API, UI) speaks to the Store interface, never to SQL.
// That seam is deliberate and load-bearing: the shop product runs on SQLite, and the
// SaaS build swaps in a Postgres implementation of this same interface without a
// single caller changing. Do not leak *sql.DB, driver types, or SQL strings past here.
package store

import "context"

// Item is one physical thing in the shop. CID is permanent and never reused.
type Item struct {
	CID       int64  `json:"cid"`
	Name      string `json:"name"`
	Bin       int    `json:"bin"`
	Qty       int    `json:"qty"`
	Min       int    `json:"min"`
	Value     string `json:"value"`
	Pkg       string `json:"pkg"`
	Part      string `json:"part"`
	Supplier  string `json:"supplier"`
	Source    string `json:"source"`
	Link      string `json:"link"`
	Notes     string `json:"notes"`
	CreatedAt int64  `json:"created"`
	UpdatedAt int64  `json:"updated"`
	CountedAt *int64 `json:"counted,omitempty"`
}

// Dept returns the department digit encoded in the bin (bin/1000).
func (i Item) Dept() int { return i.Bin / 1000 }

// Section returns the section digit encoded in the bin ((bin/100)%10).
func (i Item) Section() int { return (i.Bin / 100) % 10 }

// Low reports whether the item is at or below its reorder minimum.
func (i Item) Low() bool { return i.Qty <= i.Min }

// ItemQuery is every way the UI is allowed to slice the item table. It always
// paginates: no call path in the product may load the whole inventory into memory.
type ItemQuery struct {
	Search string // space-separated tokens, AND-matched against the normalized haystack
	Bin    *int   // exact bin
	Dept   *int   // 0-9
	Sec    *int   // 0-9, only meaningful with Dept
	LowSet bool   // true = only items at/below min
	Sort   string // "name" (default), "bin", "qty", "updated"
	Desc   bool
	Limit  int // 0 -> DefaultLimit
	Offset int
	// Approx marks a live-search keystroke, where the user is looking at the top few
	// hits and does not need an exact total. It lets the store stop after CountCap
	// matches instead of counting and sorting every one. Measured on 100k items:
	// 88ms -> 2ms per keystroke. Explicit actions
	// (printing a full result list, a report) leave it false and get exact answers.
	Approx bool
}

// CountCap is how many matches an approximate search counts before giving up and
// reporting "at least this many".
const CountCap = 200

// DefaultLimit caps an unbounded list request. The terminal UI shows far fewer.
const DefaultLimit = 200

// MaxLimit is the hard ceiling on one page, regardless of what a client asks for.
const MaxLimit = 1000

// Page is a slice of results plus the total that matched, so the UI can say
// "showing 200 of 41,882" without ever holding 41,882 rows.
type Page[T any] struct {
	Rows  []T `json:"rows"`
	Total int `json:"total"`
	// Capped is true when Total is a floor rather than an exact figure, because the
	// query was approximate and hit CountCap. The UI shows "200+" in that case.
	Capped bool `json:"capped,omitempty"`
}

// Dept is one of the ten top-level departments (the first bin digit).
type Dept struct {
	N     int    `json:"n"`
	Label string `json:"label"`
	Items int    `json:"items"` // live count, computed
	Qty   int    `json:"qty"`
}

// Section is a shelf inside a department (the second bin digit).
type Section struct {
	Code  string `json:"code"` // "11"
	Dept  int    `json:"dept"`
	Digit int    `json:"digit"`
	Label string `json:"label"`
	Items int    `json:"items"`
}

// Project groups items into a build. BOM lines live in Bom.
type Project struct {
	PID       int64  `json:"pid"`
	Name      string `json:"name"`
	Notes     string `json:"notes"`
	CreatedAt int64  `json:"created"`
	Active    bool   `json:"active"`
	Parts     int    `json:"parts"` // computed line count
}

// BomLine is one part requirement inside a project.
type BomLine struct {
	PID  int64  `json:"pid"`
	CID  int64  `json:"cid"`
	Name string `json:"name"` // joined for display
	Need int    `json:"need"`
	Have int    `json:"have"` // joined current stock
}

// LogEntry is one mutation. Entries carrying an Undo payload are reversible;
// the log is both the audit trail and the undo stack.
type LogEntry struct {
	ID       int64  `json:"id"`
	TS       int64  `json:"ts"`
	Op       string `json:"op"`
	Text     string `json:"text"`
	CID      *int64 `json:"cid,omitempty"`
	Operator string `json:"operator,omitempty"`
	Undoable bool   `json:"undoable"`
	Undone   bool   `json:"undone"`
}

// Stats is the home-screen summary. It is computed by the database with aggregate
// queries, never by walking rows in Go.
type Stats struct {
	Items    int   `json:"items"`
	Pieces   int   `json:"pieces"`
	Bins     int   `json:"bins"`
	Low      int   `json:"low"`
	Projects int   `json:"projects"`
	LogSize  int   `json:"log"`
	DBBytes  int64 `json:"dbBytes"`
}

// Store is the whole data contract. A SaaS Postgres backend implements this and
// nothing else changes.
type Store interface {
	// items
	Items(ctx context.Context, q ItemQuery) (Page[Item], error)
	Item(ctx context.Context, cid int64) (Item, error)
	AddItem(ctx context.Context, it Item) (Item, error)
	// BulkAdd inserts many items in one transaction and one log entry. A spreadsheet
	// import of 10k rows must not be 10k transactions, and it must undo as one step.
	BulkAdd(ctx context.Context, items []Item, source string) (int, error)
	UpdateItem(ctx context.Context, cid int64, patch map[string]any) (Item, error)
	DeleteItem(ctx context.Context, cid int64) error
	AdjustQty(ctx context.Context, cid int64, delta int) (Item, error)
	NextFreeBin(ctx context.Context, dept, sec int) (int, error)

	// layout
	Depts(ctx context.Context) ([]Dept, error)
	Sections(ctx context.Context, dept int) ([]Section, error)
	SetDept(ctx context.Context, n int, label string) error
	SetSection(ctx context.Context, code, label string) error

	// projects
	Projects(ctx context.Context) ([]Project, error)
	Bom(ctx context.Context, pid int64) ([]BomLine, error)

	// history
	Log(ctx context.Context, limit, offset int) (Page[LogEntry], error)
	Undo(ctx context.Context) (LogEntry, error)

	// misc
	Stats(ctx context.Context) (Stats, error)
	Meta(ctx context.Context, key string) (string, error)
	SetMeta(ctx context.Context, key, value string) error
	Close() error
}
