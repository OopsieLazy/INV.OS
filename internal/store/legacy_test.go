package store_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"invos/internal/legacy"
	"invos/internal/store"
)

// A v20.2 export, in the shape the old download button produced: the bare state object,
// with the two things that make this migration worth testing — explicit C-IDs that must
// survive, and a project BOM that points at them by number.
const v202Export = `{
  "items": [
    {"cid":1,"name":"Resistor 10k","bin":1101,"qty":180,"min":50,"value":"10k","pkg":"THT","part":"-","notes":"pull-ups"},
    {"cid":7,"name":"OLED 128x64","bin":1503,"qty":4,"min":2,"value":"SSD1306","pkg":"I2C","supplier":"Adafruit"},
    {"cid":42,"name":"M3x10 cap screw","bin":"2101","qty":"500","min":"100"}
  ],
  "projects": [
    {"pid":3,"name":"Bench meter","status":"building","created":1700000000000,
     "bom":[{"cid":7,"need":1},{"cid":1,"need":4},{"cid":999,"need":2}]}
  ],
  "activeProject": 3,
  "classes": ["GENERAL","ELECTRICAL","FASTENERS"],
  "sections": {"11":"RESISTORS","15":"DISPLAYS","21":"SCREWS"},
  "counted": {"1": 1699999999000}
}`

func openTemp(t *testing.T) *store.SQLite {
	t.Helper()
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// The headline guarantee: what went in comes back out, with the same numbers.
func TestLegacyImportRoundTrip(t *testing.T) {
	ctx := context.Background()
	db := openTemp(t)

	snap, err := legacy.Parse([]byte(v202Export))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	res, err := db.ImportLegacy(ctx, snap)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if res.Items != 3 || res.Projects != 1 {
		t.Fatalf("imported %d items / %d projects, want 3/1", res.Items, res.Projects)
	}
	// The BOM line pointing at C-0999, which is not in the file, must be dropped and
	// SAID so — a dangling BOM row is exactly the kind of thing a silent import hides.
	if res.BomLines != 2 {
		t.Fatalf("kept %d BOM lines, want 2 (the one for a missing part is dropped)", res.BomLines)
	}
	if len(res.Skipped) == 0 {
		t.Fatal("the dropped BOM line was not reported")
	}

	// C-IDs survive: this is the whole point, because labels are already on drawers.
	for _, want := range []struct {
		cid  int64
		name string
		bin  int
		qty  int
	}{{1, "Resistor 10k", 1101, 180}, {7, "OLED 128x64", 1503, 4}, {42, "M3x10 cap screw", 2101, 500}} {
		got, err := db.Item(ctx, want.cid)
		if err != nil {
			t.Fatalf("C-%04d missing after import: %v", want.cid, err)
		}
		if got.Name != want.name || got.Bin != want.bin || got.Qty != want.qty {
			t.Errorf("C-%04d = %q bin %d qty %d, want %q bin %d qty %d",
				want.cid, got.Name, got.Bin, got.Qty, want.name, want.bin, want.qty)
		}
	}

	// Strings where the old build wrote numbers must still land as numbers.
	if it, _ := db.Item(ctx, 42); it.Bin != 2101 || it.Qty != 500 || it.Min != 100 {
		t.Errorf("string-valued row parsed as bin %d qty %d min %d", it.Bin, it.Qty, it.Min)
	}

	// The project keeps its PID and its active flag.
	p, err := db.Project(ctx, 3)
	if err != nil {
		t.Fatalf("project 3 missing: %v", err)
	}
	if p.Name != "Bench meter" || p.Status != "building" || !p.Active {
		t.Errorf("project = %+v", p)
	}
	bom, _ := db.Bom(ctx, 3)
	if len(bom) != 2 {
		t.Fatalf("BOM has %d lines, want 2", len(bom))
	}

	// Shelf names came across, and the department they imply was created for them.
	secs, err := db.Sections(ctx, 1)
	if err != nil {
		t.Fatalf("sections: %v", err)
	}
	var found bool
	for _, s := range secs {
		if s.Label == "RESISTORS" {
			found = true
		}
	}
	if !found {
		t.Errorf("shelf 11 name did not survive: %+v", secs)
	}
}

// A new item added after an import must not be handed a number the import already used.
// Reusing a C-ID means a printed label points at two different drawers.
func TestLegacyImportDoesNotReuseCIDs(t *testing.T) {
	ctx := context.Background()
	db := openTemp(t)
	snap, _ := legacy.Parse([]byte(v202Export))
	if _, err := db.ImportLegacy(ctx, snap); err != nil {
		t.Fatalf("import: %v", err)
	}
	added, err := db.AddItem(ctx, store.Item{Name: "New part", Bin: 1101, Qty: 1})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if added.CID <= 42 {
		t.Fatalf("new item got C-%04d, which collides with the imported block (max 42)", added.CID)
	}
}

// Importing on top of an existing inventory would make two drawers claim one number.
func TestLegacyImportRefusesOnCIDCollision(t *testing.T) {
	ctx := context.Background()
	db := openTemp(t)
	snap, _ := legacy.Parse([]byte(v202Export))
	if _, err := db.ImportLegacy(ctx, snap); err != nil {
		t.Fatalf("first import: %v", err)
	}
	if _, err := db.ImportLegacy(ctx, snap); err == nil {
		t.Fatal("importing the same file twice was allowed; it must refuse on collision")
	}
}

// One import, one undo.
func TestLegacyImportUndoesInOneStep(t *testing.T) {
	ctx := context.Background()
	db := openTemp(t)
	snap, _ := legacy.Parse([]byte(v202Export))
	if _, err := db.ImportLegacy(ctx, snap); err != nil {
		t.Fatalf("import: %v", err)
	}
	if _, err := db.Undo(ctx); err != nil {
		t.Fatalf("undo: %v", err)
	}
	st, _ := db.Stats(ctx)
	if st.Items != 0 {
		t.Errorf("%d items left after undo, want 0", st.Items)
	}
	if projs, _ := db.Projects(ctx); len(projs) != 0 {
		t.Errorf("%d projects left after undo, want 0", len(projs))
	}
}

// The same inventory arrives wrapped in the checksummed envelope, and nested one deeper
// the way the blob server stored it. Both must reach the same place.
func TestLegacyParseUnwrapsEnvelopes(t *testing.T) {
	env, _ := json.Marshal(map[string]any{"v": 20, "ts": 1, "sum": "abc", "data": v202Export})
	outer, _ := json.Marshal(map[string]any{"blob": string(env), "updated_at": 2})

	for name, raw := range map[string][]byte{"bare": []byte(v202Export), "envelope": env, "blob-server": outer} {
		snap, err := legacy.Parse(raw)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(snap.Items) != 3 || len(snap.Projects) != 1 {
			t.Errorf("%s: got %d items / %d projects, want 3/1", name, len(snap.Items), len(snap.Projects))
		}
	}
}

func TestLegacyParseRejectsRubbish(t *testing.T) {
	for name, raw := range map[string]string{
		"not json":   "<html>nope</html>",
		"empty":      `{"items":[],"projects":[]}`,
		"wrong file": `{"hello":"world"}`,
	} {
		if _, err := legacy.Parse([]byte(raw)); err == nil {
			t.Errorf("%s: accepted, want an error", name)
		}
	}
}
