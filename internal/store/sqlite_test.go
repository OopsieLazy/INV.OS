package store

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

func open(t *testing.T) *SQLite {
	t.Helper()
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func add(t *testing.T, s *SQLite, name string, bin, qty, min int) Item {
	t.Helper()
	it, err := s.AddItem(context.Background(), Item{Name: name, Bin: bin, Qty: qty, Min: min})
	if err != nil {
		t.Fatalf("add %q: %v", name, err)
	}
	return it
}

func TestSeedsDefaultLayout(t *testing.T) {
	s := open(t)
	depts, err := s.Depts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(depts) != 10 {
		t.Fatalf("want 10 departments, got %d", len(depts))
	}
	if depts[1].Label != "ELECTRICAL / ELECTRONICS" {
		t.Errorf("dept 1 = %q", depts[1].Label)
	}
}

// Search must behave exactly like the HTML app: tokens AND-match, and the unit
// characters nobody can type are folded, so "10kohm" finds "10kΩ".
func TestSearchIsUnicodeTolerant(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	add(t, s, "Resistor 10kΩ", 1110, 50, 10)
	add(t, s, "Capacitor 100µF", 1210, 3, 5)

	for _, tc := range []struct{ query, want string }{
		{"10kohm", "Resistor 10kΩ"},
		{"10kΩ", "Resistor 10kΩ"},
		{"100uf", "Capacitor 100µF"},
		{"res 10k", "Resistor 10kΩ"},   // multi-token AND
		{"RESISTORS", "Resistor 10kΩ"}, // matches via the shelf label
	} {
		page, err := s.Items(ctx, ItemQuery{Search: tc.query})
		if err != nil {
			t.Fatalf("%q: %v", tc.query, err)
		}
		if page.Total != 1 || page.Rows[0].Name != tc.want {
			t.Errorf("search %q -> %d hits %v, want just %q",
				tc.query, page.Total, names(page.Rows), tc.want)
		}
	}
}

// A search for "50%" must find a literal percent sign, not every row.
func TestSearchEscapesLikeWildcards(t *testing.T) {
	s := open(t)
	add(t, s, "Isopropyl 50% 1L", 810, 2, 1)
	add(t, s, "Sandpaper 220 grit", 830, 10, 2)

	page, err := s.Items(context.Background(), ItemQuery{Search: "50%"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("literal %% search matched %d rows %v, want 1", page.Total, names(page.Rows))
	}
}

func TestAdjustQtyClampsAtZero(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	it := add(t, s, "Widget", 9110, 10, 2)

	got, err := s.AdjustQty(ctx, it.CID, -4)
	if err != nil {
		t.Fatal(err)
	}
	if got.Qty != 6 {
		t.Errorf("take 4 from 10 -> %d, want 6", got.Qty)
	}
	// Taking more than you have is a normal shop event (miscount), not an error —
	// it must floor at zero rather than record negative stock.
	if got, err = s.AdjustQty(ctx, it.CID, -99); err != nil {
		t.Fatal(err)
	}
	if got.Qty != 0 {
		t.Errorf("over-take -> %d, want 0", got.Qty)
	}
}

// The patch builder sorts columns for a stable statement; this proves the values are
// sorted along with them. A regression here silently writes fields into wrong columns.
func TestUpdateItemPairsColumnsWithValues(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	it := add(t, s, "Widget", 9110, 10, 2)

	got, err := s.UpdateItem(ctx, it.CID, map[string]any{
		"name": "Widget Pro", "min": 5, "qty": 7, "notes": "top drawer", "bin": 9120,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Name != "Widget Pro" || got.Min != 5 || got.Qty != 7 ||
		got.Notes != "top drawer" || got.Bin != 9120 {
		t.Fatalf("fields landed wrong: %+v", got)
	}
}

func TestUpdateItemRejectsUnknownField(t *testing.T) {
	s := open(t)
	it := add(t, s, "Widget", 9110, 1, 0)
	if _, err := s.UpdateItem(context.Background(), it.CID, map[string]any{"cid": 999}); err == nil {
		t.Fatal("editing cid was allowed; it must be refused")
	}
}

// The whole promise of the ID system: a restored item keeps its original CID, so the
// label already stuck on the drawer still points at the right thing.
func TestUndoDeleteRestoresOriginalCID(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	it := add(t, s, "Widget", 9110, 10, 2)

	if err := s.DeleteItem(ctx, it.CID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Item(ctx, it.CID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete, Item() -> %v, want ErrNotFound", err)
	}
	if _, err := s.Undo(ctx); err != nil {
		t.Fatal(err)
	}
	back, err := s.Item(ctx, it.CID)
	if err != nil {
		t.Fatalf("undo did not restore the item: %v", err)
	}
	if back.CID != it.CID || back.Name != it.Name || back.Qty != it.Qty {
		t.Errorf("restored %+v, want %+v", back, it)
	}
}

func TestUndoWalksBackwards(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	it := add(t, s, "Widget", 9110, 10, 2)

	if _, err := s.AdjustQty(ctx, it.CID, -3); err != nil { // 7
		t.Fatal(err)
	}
	if _, err := s.UpdateItem(ctx, it.CID, map[string]any{"name": "Renamed"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Undo(ctx); err != nil { // undo the rename
		t.Fatal(err)
	}
	if _, err := s.Undo(ctx); err != nil { // undo the take
		t.Fatal(err)
	}
	got, err := s.Item(ctx, it.CID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Widget" || got.Qty != 10 {
		t.Errorf("after two undos: %q qty %d, want \"Widget\" qty 10", got.Name, got.Qty)
	}
}

func TestUndoExhausts(t *testing.T) {
	s := open(t)
	if _, err := s.Undo(context.Background()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("undo on an empty log -> %v, want ErrNotFound", err)
	}
}

func TestNextFreeBinCountsUpFromTen(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	bin, err := s.NextFreeBin(ctx, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if bin != 1110 {
		t.Fatalf("first free bin in section 11 = %d, want 1110", bin)
	}
	add(t, s, "A", 1110, 1, 0)
	if bin, err = s.NextFreeBin(ctx, 1, 1); err != nil || bin != 1111 {
		t.Fatalf("next free bin = %d (%v), want 1111", bin, err)
	}
}

// Clearing a shelf that still holds stock would orphan those items in a nameless
// location, so the store refuses and tells the user to move them first.
func TestClearingOccupiedSectionIsRefused(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	add(t, s, "Resistor", 1110, 5, 1)

	if err := s.SetSection(ctx, "11", ""); err == nil {
		t.Fatal("clearing an occupied shelf was allowed")
	}
	if err := s.SetSection(ctx, "44", ""); err != nil {
		t.Fatalf("clearing an empty shelf failed: %v", err)
	}
}

// Renaming a shelf changes what its items match on, so their search text must be
// rebuilt immediately — not on next edit.
func TestRenamingDeptReindexesSearch(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	add(t, s, "Lathe Tool", 9110, 1, 0)

	if err := s.SetDept(ctx, 9, "MACHINE SHOP"); err != nil {
		t.Fatal(err)
	}
	page, err := s.Items(ctx, ItemQuery{Search: "machine shop"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("renamed department not searchable: %d hits", page.Total)
	}
}

func TestItemsAlwaysPaginate(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	for i := range 250 {
		add(t, s, fmt.Sprintf("Part %03d", i), 1110+i%80, 1, 0)
	}
	page, err := s.Items(ctx, ItemQuery{}) // no limit given
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 250 {
		t.Errorf("Total = %d, want the full 250", page.Total)
	}
	if len(page.Rows) != DefaultLimit {
		t.Errorf("returned %d rows, want a capped page of %d", len(page.Rows), DefaultLimit)
	}
	if page, err = s.Items(ctx, ItemQuery{Limit: 99999}); err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) > MaxLimit {
		t.Errorf("a client asking for 99999 rows got %d; MaxLimit is %d", len(page.Rows), MaxLimit)
	}
}

func TestStatsAggregates(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	add(t, s, "A", 1110, 10, 2)
	add(t, s, "B", 1210, 1, 5) // low
	add(t, s, "C", 1210, 0, 0) // low: qty <= min

	st, err := s.Stats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.Items != 3 || st.Pieces != 11 || st.Bins != 2 || st.Low != 2 {
		t.Errorf("stats = %+v, want items 3 pieces 11 bins 2 low 2", st)
	}
}

// Two tablets taking from the same bin at the same moment is the concurrency case
// this product actually faces. Every decrement must land: no lost updates.
func TestConcurrentTakesDoNotLoseUpdates(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	it := add(t, s, "Screws", 2110, 1000, 10)

	const workers, each = 8, 25
	var wg sync.WaitGroup
	errs := make(chan error, workers*each)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range each {
				if _, err := s.AdjustQty(ctx, it.CID, -1); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent take failed: %v", err)
	}

	got, err := s.Item(ctx, it.CID)
	if err != nil {
		t.Fatal(err)
	}
	if want := 1000 - workers*each; got.Qty != want {
		t.Errorf("qty = %d after %d concurrent takes, want %d (lost updates)",
			got.Qty, workers*each, want)
	}
}

func names(items []Item) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.Name
	}
	return out
}

// Trigram indexing must not change what search finds: fragments still match anywhere
// in the text, not just at the start of a word.
func TestSearchMatchesMidWordFragments(t *testing.T) {
	s := open(t)
	add(t, s, "Resistor 10kΩ", 1110, 5, 1)

	for _, frag := range []string{"sist", "ohm", "10k"} {
		page, err := s.Items(context.Background(), ItemQuery{Search: frag})
		if err != nil {
			t.Fatalf("%q: %v", frag, err)
		}
		if page.Total != 1 {
			t.Errorf("fragment %q matched %d rows, want 1", frag, page.Total)
		}
	}
}

// Fragments shorter than a trigram cannot use the index and fall back to a scan;
// they must still return the right rows.
func TestShortFragmentsStillMatch(t *testing.T) {
	s := open(t)
	add(t, s, "Nut M3", 2210, 100, 10)
	add(t, s, "Bolt M4", 2110, 50, 10)

	page, err := s.Items(context.Background(), ItemQuery{Search: "m3"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Rows[0].Name != "Nut M3" {
		t.Errorf("short fragment search -> %d %v, want just Nut M3", page.Total, names(page.Rows))
	}
}

// Approximate search stops counting at CountCap and says so, instead of walking every
// match on each keystroke. Exact search still reports the true total.
func TestApproxSearchCapsTheCount(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	items := make([]Item, 0, CountCap+50)
	for i := range CountCap + 50 {
		items = append(items, Item{Name: fmt.Sprintf("Resistor %d", i), Bin: 1110, Qty: 1})
	}
	if _, err := s.BulkAdd(ctx, items, "test"); err != nil {
		t.Fatal(err)
	}

	approx, err := s.Items(ctx, ItemQuery{Search: "resistor", Limit: 8, Approx: true})
	if err != nil {
		t.Fatal(err)
	}
	if !approx.Capped || approx.Total != CountCap {
		t.Errorf("approx: total %d capped %v, want %d and capped", approx.Total, approx.Capped, CountCap)
	}
	if len(approx.Rows) != 8 {
		t.Errorf("approx returned %d rows, want the 8 asked for", len(approx.Rows))
	}

	exact, err := s.Items(ctx, ItemQuery{Search: "resistor", Limit: 8})
	if err != nil {
		t.Fatal(err)
	}
	if exact.Capped || exact.Total != CountCap+50 {
		t.Errorf("exact: total %d capped %v, want %d and not capped",
			exact.Total, exact.Capped, CountCap+50)
	}
}

// Counters are maintained by triggers, so they must stay correct through every kind of
// mutation — including a move, which changes which shelf an item counts toward.
func TestShelfCountersTrackMutations(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	deptQty := func(n int) (int, int) {
		t.Helper()
		depts, err := s.Depts(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return depts[n].Items, depts[n].Qty
	}

	it := add(t, s, "Widget", 1110, 10, 1)
	if c, q := deptQty(1); c != 1 || q != 10 {
		t.Fatalf("after add: %d items %d qty, want 1 and 10", c, q)
	}

	if _, err := s.AdjustQty(ctx, it.CID, +5); err != nil {
		t.Fatal(err)
	}
	if c, q := deptQty(1); c != 1 || q != 15 {
		t.Errorf("after stock: %d items %d qty, want 1 and 15", c, q)
	}

	// move it to another department: the old shelf must give the count back
	if _, err := s.UpdateItem(ctx, it.CID, map[string]any{"bin": 5110}); err != nil {
		t.Fatal(err)
	}
	if c, q := deptQty(1); c != 0 || q != 0 {
		t.Errorf("old department after move: %d items %d qty, want 0 and 0", c, q)
	}
	if c, q := deptQty(5); c != 1 || q != 15 {
		t.Errorf("new department after move: %d items %d qty, want 1 and 15", c, q)
	}

	if err := s.DeleteItem(ctx, it.CID); err != nil {
		t.Fatal(err)
	}
	if c, q := deptQty(5); c != 0 || q != 0 {
		t.Errorf("after delete: %d items %d qty, want 0 and 0", c, q)
	}
}

// A whole spreadsheet import is one undo step, not one per row.
func TestBulkAddUndoesAsOneStep(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	n, err := s.BulkAdd(ctx, []Item{
		{Name: "Alpha", Bin: 1110, Qty: 1},
		{Name: "Beta", Bin: 1120, Qty: 2},
		{Name: "Gamma", Bin: 1130, Qty: 3},
	}, "test.csv")
	if err != nil || n != 3 {
		t.Fatalf("bulk add: %d %v", n, err)
	}
	st, _ := s.Stats(ctx)
	if st.Items != 3 {
		t.Fatalf("after import: %d items, want 3", st.Items)
	}
	// imported rows must be searchable straight away
	page, _ := s.Items(ctx, ItemQuery{Search: "beta"})
	if page.Total != 1 {
		t.Errorf("imported item not searchable: %d hits", page.Total)
	}

	if _, err := s.Undo(ctx); err != nil {
		t.Fatal(err)
	}
	if st, _ = s.Stats(ctx); st.Items != 0 {
		t.Errorf("after undoing the import: %d items, want 0", st.Items)
	}
}

func TestProjectLifecycle(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	p, err := s.AddProject(ctx, "Weather Station")
	if err != nil {
		t.Fatal(err)
	}
	if p.PID == 0 || p.Status != "planning" {
		t.Fatalf("new project: %+v", p)
	}

	if _, err := s.UpdateProject(ctx, p.PID, map[string]any{"status": "building", "notes": "on the bench"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Project(ctx, p.PID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "building" || got.Notes != "on the bench" {
		t.Errorf("after edit: %+v", got)
	}

	if _, err := s.UpdateProject(ctx, p.PID, map[string]any{"pid": 9}); err == nil {
		t.Error("editing pid was allowed; it must be refused")
	}

	// exactly one project is active at a time
	q, _ := s.AddProject(ctx, "Robot Arm")
	if err := s.SetActiveProject(ctx, p.PID); err != nil {
		t.Fatal(err)
	}
	if err := s.SetActiveProject(ctx, q.PID); err != nil {
		t.Fatal(err)
	}
	list, err := s.Projects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	active := 0
	for _, x := range list {
		if x.Active {
			active++
			if x.PID != q.PID {
				t.Errorf("wrong project active: %d", x.PID)
			}
		}
	}
	if active != 1 {
		t.Errorf("%d projects active, want exactly 1", active)
	}
}

func TestBomTracksStock(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	esp := add(t, s, "ESP32 DevKit", 1610, 3, 1)
	oled := add(t, s, "OLED 128x64", 1510, 1, 1)
	p, _ := s.AddProject(ctx, "Weather Station")

	if err := s.SetBomLine(ctx, p.PID, esp.CID, 1); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBomLine(ctx, p.PID, oled.CID, 2); err != nil {
		t.Fatal(err)
	}

	lines, err := s.Bom(ctx, p.PID)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 {
		t.Fatalf("%d BOM lines, want 2", len(lines))
	}
	// the join must report live stock, so "need 2, have 1" is visible without a
	// second query per line
	for _, l := range lines {
		switch l.CID {
		case esp.CID:
			if l.Need != 1 || l.Have != 3 {
				t.Errorf("esp line need %d have %d, want 1/3", l.Need, l.Have)
			}
		case oled.CID:
			if l.Need != 2 || l.Have != 1 {
				t.Errorf("oled line need %d have %d, want 2/1", l.Need, l.Have)
			}
		}
	}

	// taking stock must be reflected in the BOM view straight away
	if _, err := s.AdjustQty(ctx, esp.CID, -2); err != nil {
		t.Fatal(err)
	}
	lines, _ = s.Bom(ctx, p.PID)
	for _, l := range lines {
		if l.CID == esp.CID && l.Have != 1 {
			t.Errorf("after taking 2, BOM shows have %d, want 1", l.Have)
		}
	}

	if err := s.RemoveBomLine(ctx, p.PID, oled.CID); err != nil {
		t.Fatal(err)
	}
	if lines, _ = s.Bom(ctx, p.PID); len(lines) != 1 {
		t.Errorf("%d lines after removing one, want 1", len(lines))
	}
}

// Deleting an item must not leave a dangling BOM line pointing at nothing.
func TestDeletingAnItemClearsItsBomLines(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	it := add(t, s, "Jumper Wires", 1810, 100, 10)
	p, _ := s.AddProject(ctx, "Robot Arm")
	if err := s.SetBomLine(ctx, p.PID, it.CID, 20); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteItem(ctx, it.CID); err != nil {
		t.Fatal(err)
	}
	lines, err := s.Bom(ctx, p.PID)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 0 {
		t.Errorf("%d BOM lines survived the item deletion", len(lines))
	}
}

// Undoing a project deletion must bring back the build AND its parts list.
func TestUndoProjectDeleteRestoresBom(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	a := add(t, s, "ESP32", 1610, 5, 1)
	b := add(t, s, "OLED", 1510, 5, 1)
	p, _ := s.AddProject(ctx, "Desk Clock")
	s.SetBomLine(ctx, p.PID, a.CID, 1)
	s.SetBomLine(ctx, p.PID, b.CID, 2)

	if err := s.DeleteProject(ctx, p.PID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Project(ctx, p.PID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("project still there after delete: %v", err)
	}
	if _, err := s.Undo(ctx); err != nil {
		t.Fatal(err)
	}
	back, err := s.Project(ctx, p.PID)
	if err != nil {
		t.Fatalf("undo did not restore the project: %v", err)
	}
	if back.PID != p.PID || back.Name != "Desk Clock" {
		t.Errorf("restored %+v, want the original", back)
	}
	lines, _ := s.Bom(ctx, p.PID)
	if len(lines) != 2 {
		t.Errorf("%d BOM lines restored, want 2", len(lines))
	}
}

func TestUndoBomChanges(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	it := add(t, s, "Screws M3", 2110, 500, 50)
	p, _ := s.AddProject(ctx, "Enclosure")

	s.SetBomLine(ctx, p.PID, it.CID, 8)
	s.SetBomLine(ctx, p.PID, it.CID, 12) // change the quantity
	if _, err := s.Undo(ctx); err != nil {
		t.Fatal(err)
	}
	lines, _ := s.Bom(ctx, p.PID)
	if len(lines) != 1 || lines[0].Need != 8 {
		t.Fatalf("after undoing the change: %+v, want need 8", lines)
	}
	if _, err := s.Undo(ctx); err != nil { // undo the original add
		t.Fatal(err)
	}
	if lines, _ = s.Bom(ctx, p.PID); len(lines) != 0 {
		t.Errorf("%d lines after undoing the add, want 0", len(lines))
	}
}

// SharedParts is what draws the bridges between clusters in the galaxy view.
func TestSharedPartsFindsBridges(t *testing.T) {
	s := open(t)
	ctx := context.Background()

	esp := add(t, s, "ESP32", 1610, 10, 1)
	oled := add(t, s, "OLED", 1510, 10, 1)
	only := add(t, s, "Stepper", 1520, 10, 1)

	weather, _ := s.AddProject(ctx, "Weather Station")
	clock, _ := s.AddProject(ctx, "Desk Clock")
	arm, _ := s.AddProject(ctx, "Robot Arm")

	s.SetBomLine(ctx, weather.PID, esp.CID, 1)
	s.SetBomLine(ctx, clock.PID, esp.CID, 1)
	s.SetBomLine(ctx, weather.PID, oled.CID, 1)
	s.SetBomLine(ctx, clock.PID, oled.CID, 1)
	s.SetBomLine(ctx, arm.PID, only.CID, 1)

	shared, err := s.SharedParts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(shared) != 2 {
		t.Fatalf("%d shared parts, want 2 (ESP32 and OLED)", len(shared))
	}
	for _, sp := range shared {
		if len(sp.Projects) != 2 {
			t.Errorf("%s shared by %d projects, want 2", sp.Name, len(sp.Projects))
		}
		if sp.CID == only.CID {
			t.Error("a part used by one project was reported as shared")
		}
	}
}
