package store_test

import (
	"context"
	"strings"
	"testing"

	"invos/internal/store"
)

// The point of the whole feature: a shop can answer "who took the last one".
func TestLogRecordsWhoDidIt(t *testing.T) {
	db := openTemp(t)
	dave := store.WithOperator(context.Background(), "Dave")
	sam := store.WithOperator(context.Background(), "sam")

	it, err := db.AddItem(dave, store.Item{Name: "Drill bit 3mm", Bin: 9101, Qty: 10})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if _, err := db.AdjustQty(sam, it.CID, -3); err != nil {
		t.Fatalf("take: %v", err)
	}

	page, err := db.Log(context.Background(), store.LogQuery{Limit: 50})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	var sawDave, sawSam bool
	for _, e := range page.Rows {
		if e.Operator == "Dave" {
			sawDave = true
		}
		if e.Operator == "sam" {
			sawSam = true
		}
	}
	if !sawDave || !sawSam {
		t.Fatalf("operators missing from the log: %+v", page.Rows)
	}

	// `recent by <name>`, and the count must match the filter — "12 of 4000" when you
	// asked for one person's changes answers a question nobody asked.
	byDave, err := db.Log(context.Background(), store.LogQuery{Operator: "Dave", Limit: 50})
	if err != nil {
		t.Fatalf("log by: %v", err)
	}
	if byDave.Total != len(byDave.Rows) || byDave.Total == 0 {
		t.Fatalf("filtered total %d vs %d rows", byDave.Total, len(byDave.Rows))
	}
	for _, e := range byDave.Rows {
		if e.Operator != "Dave" {
			t.Errorf("filtering by Dave returned %q", e.Operator)
		}
	}

	// People type their own name inconsistently; finding nothing because they once
	// typed it differently is a bug to the person using it.
	lower, _ := db.Log(context.Background(), store.LogQuery{Operator: "dave", Limit: 50})
	if lower.Total != byDave.Total {
		t.Errorf("case-insensitive match: %d vs %d", lower.Total, byDave.Total)
	}

	// One item's whole history.
	hist, err := db.Log(context.Background(), store.LogQuery{CID: &it.CID, Limit: 50})
	if err != nil {
		t.Fatalf("log cid: %v", err)
	}
	if hist.Total < 2 {
		t.Errorf("item history has %d entries, want the add and the take", hist.Total)
	}
}

// A change with nobody set is still recorded. Refusing the write would teach people to
// work around the app, which is worse than an unattributed row.
func TestUnattributedChangesAreStillRecorded(t *testing.T) {
	db := openTemp(t)
	if _, err := db.AddItem(context.Background(), store.Item{Name: "Anon part", Bin: 9102, Qty: 1}); err != nil {
		t.Fatalf("add: %v", err)
	}
	page, _ := db.Log(context.Background(), store.LogQuery{Limit: 10})
	if len(page.Rows) == 0 {
		t.Fatal("nothing logged")
	}
	if page.Rows[0].Operator != "" {
		t.Errorf("operator is %q, want empty", page.Rows[0].Operator)
	}
}

func TestCleanOperator(t *testing.T) {
	cases := map[string]string{
		"  Dave  ":                  "Dave",
		"":                          "",
		"   ":                       "",
		"Dave\nop: deleted 400 rows": "Daveop: deleted 400 rows", // control chars stripped, not escaped
		strings.Repeat("x", 200):     strings.Repeat("x", store.MaxOperator),
	}
	for in, want := range cases {
		if got := store.CleanOperator(in); got != want {
			t.Errorf("CleanOperator(%q) = %q, want %q", in, got, want)
		}
	}
}

// A forged newline in a name would let a log line be made to look like a different one.
func TestOperatorCannotForgeALogLine(t *testing.T) {
	db := openTemp(t)
	ctx := store.WithOperator(context.Background(), "x\nDave took 400")
	if _, err := db.AddItem(ctx, store.Item{Name: "Forge test", Bin: 9103, Qty: 1}); err != nil {
		t.Fatalf("add: %v", err)
	}
	page, _ := db.Log(context.Background(), store.LogQuery{Limit: 5})
	if strings.ContainsAny(page.Rows[0].Operator, "\n\r") {
		t.Errorf("newline survived into the log: %q", page.Rows[0].Operator)
	}
}
