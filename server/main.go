// INV.OS sync server — a single-binary, SQLite-backed backend.
// It exists ONLY to give the app an optional place to store/sync its data.
// The app works fully offline without this; run this only when you want a
// server-backed, client-by-client-customizable deployment.
//
// Build:  go build -o invos-server main.go
// Run:    ./invos-server            (serves ./deploy on :8137, db at ./invos.db)
// Env:    INVOS_PORT, INVOS_DB, INVOS_STATIC, INVOS_TOKEN (optional shared secret)
package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite, no cgo — keeps the single-binary promise
)

var db *sql.DB
var token = os.Getenv("INVOS_TOKEN")

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	dbPath := env("INVOS_DB", "invos.db")
	port := env("INVOS_PORT", "8137")
	static := env("INVOS_STATIC", "./deploy")

	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	// Schema: whole-state blobs (checksummed by the app) + a config/sections table
	// the app can GET on startup. One DB file = one client.
	mustExec(`CREATE TABLE IF NOT EXISTS state (
		id INTEGER PRIMARY KEY CHECK (id=1),
		blob TEXT NOT NULL,
		updated_at INTEGER NOT NULL
	)`)
	mustExec(`CREATE TABLE IF NOT EXISTS config (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`)
	// keep a rolling history of states for server-side integrity/rollback
	mustExec(`CREATE TABLE IF NOT EXISTS history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		blob TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", withCORS(auth(handleState)))
	mux.HandleFunc("/api/config", withCORS(auth(handleConfig)))
	mux.HandleFunc("/api/health", withCORS(handleHealth))
	// serve the app itself so one binary hosts everything
	mux.Handle("/", http.FileServer(http.Dir(static)))

	log.Printf("INV.OS server on :%s  db=%s  static=%s  auth=%v", port, dbPath, static, token != "")
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func mustExec(q string) {
	if _, err := db.Exec(q); err != nil {
		log.Fatalf("schema: %v", err)
	}
}

// --- middleware ---
func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-INVOS-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		h(w, r)
	}
}
func auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if token != "" && r.Header.Get("X-INVOS-Token") != token {
			http.Error(w, "unauthorized", 401)
			return
		}
		h(w, r)
	}
}

// --- handlers ---
// GET  /api/state  -> {blob, updated_at}   (the whole inventory JSON the app saved)
// PUT  /api/state  <- raw JSON blob        (app pushes its checksummed state)
func handleState(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		var blob string
		var ts int64
		err := db.QueryRow(`SELECT blob, updated_at FROM state WHERE id=1`).Scan(&blob, &ts)
		if err == sql.ErrNoRows {
			writeJSON(w, map[string]any{"blob": nil, "updated_at": 0})
			return
		}
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"blob": json.RawMessage(blob), "updated_at": ts})
	case http.MethodPut, http.MethodPost:
		body, err := readBody(r)
		if err != nil {
			http.Error(w, "bad body", 400)
			return
		}
		now := time.Now().UnixMilli()
		_, err = db.Exec(`INSERT INTO state (id, blob, updated_at) VALUES (1, ?, ?)
			ON CONFLICT(id) DO UPDATE SET blob=excluded.blob, updated_at=excluded.updated_at`, body, now)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		// append to history (keep last 50 server-side)
		db.Exec(`INSERT INTO history (blob, created_at) VALUES (?, ?)`, body, now)
		db.Exec(`DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 50)`)
		writeJSON(w, map[string]any{"ok": true, "updated_at": now})
	default:
		http.Error(w, "method", 405)
	}
}

// GET /api/config -> { key: value, ... }   (per-client customization: sections, etc.)
// PUT /api/config <- { key: value }
func handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := db.Query(`SELECT key, value FROM config`)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()
		out := map[string]json.RawMessage{}
		for rows.Next() {
			var k, v string
			rows.Scan(&k, &v)
			out[k] = json.RawMessage(v)
		}
		writeJSON(w, out)
	case http.MethodPut, http.MethodPost:
		var m map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			http.Error(w, "bad json", 400)
			return
		}
		for k, v := range m {
			db.Exec(`INSERT INTO config (key, value) VALUES (?, ?)
				ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, string(v))
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "method", 405)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM state`).Scan(&n)
	writeJSON(w, map[string]any{"ok": true, "has_state": n > 0, "server": "invos", "version": 1})
}

// --- helpers ---
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func readBody(r *http.Request) (string, error) {
	buf := make([]byte, 0, 1<<16)
	tmp := make([]byte, 1<<15)
	for {
		n, err := r.Body.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			break
		}
		if len(buf) > 20<<20 { // 20MB cap
			break
		}
	}
	return string(buf), nil
}
