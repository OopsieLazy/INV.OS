package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// mirrors the REAL main.go: blob stored as text, returned via json.RawMessage (verbatim)
type store struct{ sync.Mutex; blob string; ts int64; cfg map[string]json.RawMessage }

func newServer() *httptest.Server {
	st := &store{cfg: map[string]json.RawMessage{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		st.Lock(); defer st.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			if st.blob == "" { json.NewEncoder(w).Encode(map[string]any{"blob": nil}); return }
			json.NewEncoder(w).Encode(map[string]any{"blob": json.RawMessage(st.blob), "updated_at": st.ts})
			return
		}
		b, _ := io.ReadAll(r.Body); st.blob = string(b); st.ts = time.Now().UnixMilli()
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		st.Lock(); defer st.Unlock()
		if r.Method == "GET" { json.NewEncoder(w).Encode(st.cfg); return }
		var m map[string]json.RawMessage; json.NewDecoder(r.Body).Decode(&m)
		for k, v := range m { st.cfg[k] = v }
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	})
	return httptest.NewServer(mux)
}

// The app checksums `data` and needs it back byte-identical. RawMessage guarantees this.
func TestBlobByteExact(t *testing.T) {
	srv := newServer(); defer srv.Close()
	env := `{"v":7,"ts":1,"sum":"abcd1234","data":"{\"items\":[{\"cid\":1,\"name\":\"Resistor 10kΩ\"}]}"}`
	req, _ := http.NewRequest("PUT", srv.URL+"/api/state", strings.NewReader(env))
	http.DefaultClient.Do(req)
	r, _ := http.Get(srv.URL + "/api/state")
	var g struct{ Blob json.RawMessage `json:"blob"` }
	json.NewDecoder(r.Body).Decode(&g)
	if string(g.Blob) != env {
		t.Fatalf("NOT byte-exact:\n got %s\nwant %s", g.Blob, env)
	}
	t.Log("blob is BYTE-EXACT after round-trip — checksum will validate, unicode intact")
}

func TestConfigSections(t *testing.T) {
	srv := newServer(); defer srv.Close()
	cfg := `{"classes":["GENERAL","BREWING","PACKAGING"],"sections":{"11":"HOPS"}}`
	req, _ := http.NewRequest("PUT", srv.URL+"/api/config", strings.NewReader(cfg))
	http.DefaultClient.Do(req)
	r, _ := http.Get(srv.URL + "/api/config")
	var g map[string]json.RawMessage; json.NewDecoder(r.Body).Decode(&g)
	var classes []string; json.Unmarshal(g["classes"], &classes)
	if len(classes) != 3 || classes[1] != "BREWING" { t.Fatalf("classes wrong: %v", classes) }
	t.Log("per-client sections served:", classes)
}
