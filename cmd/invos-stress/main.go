// Command invos-stress loads a database with a realistic shop's worth of data and
// measures what the product actually costs to run: memory held, disk used, and the
// latency of the queries the UI issues on every keystroke.
//
// It exists so decisions about SQLite vs Postgres, page sizes, and indexes are made
// against measurements rather than guesses.
//
//	go run ./cmd/invos-stress -items 100000 -projects 500
package main

import (
	"context"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"time"

	"invos/internal/store"
)

func main() {
	var (
		nItems    = flag.Int("items", 100_000, "items to seed")
		nProjects = flag.Int("projects", 500, "projects to seed")
		dbPath    = flag.String("db", "", "database file (default: a temp file, deleted after)")
		keep      = flag.Bool("keep", false, "keep the database file instead of deleting it")
		reps      = flag.Int("reps", 200, "how many times to run each measured query")
	)
	flag.Parse()

	path := *dbPath
	if path == "" {
		dir, err := os.MkdirTemp("", "invos-stress-*")
		if err != nil {
			fail(err)
		}
		path = filepath.Join(dir, "stress.db")
		if !*keep {
			defer os.RemoveAll(dir)
		}
	}

	st, err := store.OpenSQLite(path)
	if err != nil {
		fail(err)
	}
	defer st.Close()
	ctx := context.Background()

	fmt.Printf("INV.OS stress — %d items, %d projects\n", *nItems, *nProjects)
	fmt.Printf("database: %s\n\n", path)

	seed(ctx, st, *nItems, *nProjects)
	measure(ctx, st, *reps)
	report(ctx, st)
}

// nouns/adjectives generate names with realistic token overlap, so search work is not
// trivially cached and matches spread across many rows the way a real shop's do.
var (
	kinds = []string{"Resistor", "Capacitor", "Screw", "Bolt", "Nut", "Washer", "Bearing",
		"Sensor", "Module", "Connector", "Cable", "Bit", "Blade", "Filament", "Resin",
		"Paint", "Glue", "Sandpaper", "Wire", "Relay", "Diode", "Transistor", "Fuse"}
	quals = []string{"10kΩ", "100µF", "M3", "M4", "M5", "1/4in", "12V", "5V", "SMD", "THT",
		"stainless", "brass", "nylon", "PLA", "PETG", "matte", "gloss", "fine", "coarse"}
	sizes = []string{"x10", "5mm", "20cm", "1L", "250ml", "6mm", "1kg", "100pk"}
)

func seed(ctx context.Context, st *store.SQLite, nItems, nProjects int) {
	rng := rand.New(rand.NewSource(1)) // fixed seed: runs are comparable to each other
	start := time.Now()

	// Insert in batches so peak memory stays flat regardless of the total: this is the
	// same path the spreadsheet importer uses, and it must not scale with file size.
	const batch = 5_000
	buf := make([]store.Item, 0, batch)
	done := 0
	for i := range nItems {
		dept := rng.Intn(10)
		sec := rng.Intn(10)
		buf = append(buf, store.Item{
			Name: fmt.Sprintf("%s %s %s", kinds[rng.Intn(len(kinds))],
				quals[rng.Intn(len(quals))], sizes[rng.Intn(len(sizes))]),
			Bin:      dept*1000 + sec*100 + rng.Intn(90) + 10,
			Qty:      rng.Intn(500),
			Min:      rng.Intn(20),
			Pkg:      quals[rng.Intn(len(quals))],
			Part:     fmt.Sprintf("PN-%06d", i),
			Supplier: fmt.Sprintf("Supplier %d", rng.Intn(40)),
			Notes:    "seeded by invos-stress",
		})
		if len(buf) == batch {
			n, err := st.BulkAdd(ctx, buf, "stress")
			if err != nil {
				fail(err)
			}
			done += n
			buf = buf[:0]
			fmt.Printf("\r  seeding… %d/%d", done, nItems)
		}
	}
	if len(buf) > 0 {
		if _, err := st.BulkAdd(ctx, buf, "stress"); err != nil {
			fail(err)
		}
		done += len(buf)
	}

	elapsed := time.Since(start)
	fmt.Printf("\r  seeded %d items in %s (%.0f items/sec)\n",
		done, elapsed.Round(time.Millisecond), float64(done)/elapsed.Seconds())
	if nProjects > 0 {
		fmt.Printf("  (projects seeding not wired yet — BOM writes land with P2)\n")
	}
	fmt.Println()
}

type sample struct {
	name string
	durs []time.Duration
	rows int
}

func measure(ctx context.Context, st *store.SQLite, reps int) {
	rng := rand.New(rand.NewSource(2))

	cases := []struct {
		name string
		run  func() int
	}{
		{"home screen (10 dept counts)", func() int {
			d, err := st.Depts(ctx)
			if err != nil {
				fail(err)
			}
			return len(d)
		}},
		{"stats summary", func() int {
			if _, err := st.Stats(ctx); err != nil {
				fail(err)
			}
			return 1
		}},
		{"search 1 token (live, per keystroke)", func() int {
			p, err := st.Items(ctx, store.ItemQuery{
				Search: kinds[rng.Intn(len(kinds))], Limit: 8, Approx: true})
			if err != nil {
				fail(err)
			}
			return p.Total
		}},
		{"search 2 tokens", func() int {
			p, err := st.Items(ctx, store.ItemQuery{
				Search: kinds[rng.Intn(len(kinds))] + " " + quals[rng.Intn(len(quals))],
				Limit:  8, Approx: true})
			if err != nil {
				fail(err)
			}
			return p.Total
		}},
		{"open a shelf (dept+section)", func() int {
			d, s := rng.Intn(10), rng.Intn(10)
			p, err := st.Items(ctx, store.ItemQuery{Dept: &d, Sec: &s, Limit: 200})
			if err != nil {
				fail(err)
			}
			return p.Total
		}},
		{"rare term (part number lookup)", func() int {
			p, err := st.Items(ctx, store.ItemQuery{
				Search: fmt.Sprintf("PN-%06d", rng.Intn(100000)), Limit: 8, Approx: true})
			if err != nil {
				fail(err)
			}
			return p.Total
		}},
		{"search 1 token EXACT (full result list)", func() int {
			p, err := st.Items(ctx, store.ItemQuery{
				Search: kinds[rng.Intn(len(kinds))], Limit: 200})
			if err != nil {
				fail(err)
			}
			return p.Total
		}},
		{"low-stock report", func() int {
			p, err := st.Items(ctx, store.ItemQuery{LowSet: true, Limit: 200})
			if err != nil {
				fail(err)
			}
			return p.Total
		}},
		{"take 1 (write)", func() int {
			cid := int64(rng.Intn(1000) + 1)
			if _, err := st.AdjustQty(ctx, cid, +1); err != nil {
				fail(err)
			}
			return 1
		}},
	}

	fmt.Println("  query                                    p50       p95       max    matched")
	fmt.Println("  ─────────────────────────────────────────────────────────────────────────")
	for _, c := range cases {
		s := sample{name: c.name, durs: make([]time.Duration, 0, reps)}
		for range reps {
			t0 := time.Now()
			s.rows = c.run()
			s.durs = append(s.durs, time.Since(t0))
		}
		sort.Slice(s.durs, func(i, j int) bool { return s.durs[i] < s.durs[j] })
		fmt.Printf("  %-38s %7s %9s %9s %10d\n", s.name,
			ms(s.durs[len(s.durs)/2]), ms(s.durs[len(s.durs)*95/100]),
			ms(s.durs[len(s.durs)-1]), s.rows)
	}
	fmt.Println()
}

func ms(d time.Duration) string { return fmt.Sprintf("%.2fms", float64(d.Microseconds())/1000) }

func report(ctx context.Context, st *store.SQLite) {
	st2, err := st.Stats(ctx)
	if err != nil {
		fail(err)
	}
	// Force a collection first so the number reflects live data, not uncollected
	// garbage from seeding.
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	fmt.Println("  resources")
	fmt.Println("  ─────────────────────────────────────────────────────────────────────────")
	fmt.Printf("  items            %d\n", st2.Items)
	fmt.Printf("  pieces           %d\n", st2.Pieces)
	fmt.Printf("  low stock        %d\n", st2.Low)
	fmt.Printf("  log entries      %d\n", st2.LogSize)
	fmt.Printf("  database on disk %s\n", mb(st2.DBBytes))
	fmt.Printf("  go heap in use   %s\n", mb(int64(m.HeapAlloc)))
	fmt.Printf("  go heap reserved %s\n", mb(int64(m.HeapSys)))
	fmt.Printf("  process from OS  %s\n", mb(int64(m.Sys)))
	fmt.Println()
	fmt.Println("  Heap should stay roughly flat as -items grows: the server never holds the")
	fmt.Println("  inventory in memory, only the page it is answering with.")
}

func mb(b int64) string { return fmt.Sprintf("%.1f MB", float64(b)/(1024*1024)) }

func fail(err error) {
	fmt.Fprintln(os.Stderr, "stress: "+err.Error())
	os.Exit(1)
}
