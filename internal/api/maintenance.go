package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"invos/internal/store"
)

// routeMaintenance registers the cycle-count, photo, bulk-edit and export endpoints.
// They are kept apart from the item CRUD because they are the "occasionally, on
// purpose" operations rather than the ones the terminal hits constantly.
func (s *Server) routeMaintenance(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/items/{cid}/count", s.recordCount)
	mux.HandleFunc("GET /api/countlog", s.countLog)

	mux.HandleFunc("GET /api/photos", s.photoIDs)
	mux.HandleFunc("GET /api/items/{cid}/photo", s.getPhoto)
	mux.HandleFunc("PUT /api/items/{cid}/photo", s.putPhoto)
	mux.HandleFunc("DELETE /api/items/{cid}/photo", s.deletePhoto)

	mux.HandleFunc("POST /api/items/bulk-update", s.bulkUpdate)
	mux.HandleFunc("POST /api/items/merge", s.mergeItems)

	mux.HandleFunc("GET /api/export", s.exportAll)
	mux.HandleFunc("GET /api/db", s.downloadDB)
	mux.HandleFunc("GET /api/server", s.serverInfo)
}

// ── cycle count ─────────────────────────────────────────────────────────────

func (s *Server) recordCount(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var body struct {
		Actual int    `json:"actual"`
		Scope  string `json:"scope"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	it, err := s.st.RecordCount(r.Context(), cid, body.Actual, body.Scope)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, it)
}

func (s *Server) countLog(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if v, err := intParam(r, "limit"); err == nil && v != nil {
		limit = *v
	}
	entries, err := s.st.CountLog(r.Context(), limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

// ── photos ──────────────────────────────────────────────────────────────────

func (s *Server) photoIDs(w http.ResponseWriter, r *http.Request) {
	ids, err := s.st.PhotoIDs(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, ids)
}

// getPhoto serves the raw image so an <img> tag can point straight at this URL.
func (s *Server) getPhoto(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	mime, data, err := s.st.Photo(r.Context(), cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	// Photos are immutable for a given item version and the id is in the URL, but the
	// item can be re-shot — so revalidate rather than cache blindly.
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(data)
}

// putPhoto accepts a data: URL (what a canvas/file reader produces in the browser).
func (s *Server) putPhoto(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var body struct {
		DataURL string `json:"dataUrl"`
	}
	// Images are much larger than a normal request body.
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 12<<20))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	mime, data, err := decodeDataURL(body.DataURL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.SetPhoto(r.Context(), cid, mime, data); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cid": cid, "bytes": len(data)})
}

func (s *Server) deletePhoto(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.DeletePhoto(r.Context(), cid); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// decodeDataURL splits "data:image/jpeg;base64,...." into its mime type and bytes.
func decodeDataURL(s string) (string, []byte, error) {
	const prefix = "data:"
	if len(s) < len(prefix) || s[:len(prefix)] != prefix {
		return "", nil, errors.New("expected a data: URL")
	}
	comma := -1
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			comma = i
			break
		}
	}
	if comma < 0 {
		return "", nil, errors.New("malformed data: URL")
	}
	meta := s[len(prefix):comma]
	mime := meta
	isB64 := false
	if n := len(meta); n >= 7 && meta[n-7:] == ";base64" {
		mime = meta[:n-7]
		isB64 = true
	}
	if !isB64 {
		return "", nil, errors.New("only base64 data: URLs are accepted")
	}
	data, err := base64.StdEncoding.DecodeString(s[comma+1:])
	if err != nil {
		return "", nil, fmt.Errorf("photo is not valid base64: %w", err)
	}
	return mime, data, nil
}

// ── bulk maintenance ────────────────────────────────────────────────────────

func (s *Server) bulkUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		What    string            `json:"what"`
		Patches []store.ItemPatch `json:"patches"`
	}
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 32<<20))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	// JSON numbers decode as float64; the integer columns need real integers.
	for _, p := range body.Patches {
		for _, k := range []string{"bin", "qty", "min"} {
			if f, ok := p.Patch[k].(float64); ok {
				p.Patch[k] = int(f)
			}
		}
	}
	if body.What == "" {
		body.What = "bulk edit"
	}
	n, err := s.st.BulkUpdate(r.Context(), body.Patches, body.What)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"changed": n})
}

func (s *Server) mergeItems(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Keep int64 `json:"keep"`
		Drop int64 `json:"drop"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.MergeItems(r.Context(), body.Keep, body.Drop); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keep": body.Keep, "dropped": body.Drop})
}

// ── export ──────────────────────────────────────────────────────────────────

// exportAll returns the whole shop as one JSON document: items, layout, projects with
// their BOMs, the activity log and the count history. It is the off-machine backup,
// and the thing to hand someone who wants their data out.
func (s *Server) exportAll(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	items, err := s.st.Items(ctx, store.ItemQuery{Limit: store.MaxLimit, Sort: "bin"})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	all := items.Rows
	// page through the rest rather than raising the per-request ceiling
	for len(all) < items.Total {
		next, err := s.st.Items(ctx, store.ItemQuery{
			Limit: store.MaxLimit, Offset: len(all), Sort: "bin"})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		if len(next.Rows) == 0 {
			break
		}
		all = append(all, next.Rows...)
	}

	depts, _ := s.st.Depts(ctx)
	secs, _ := s.st.Sections(ctx, -1)
	projects, _ := s.st.Projects(ctx)
	counts, _ := s.st.CountLog(ctx, store.MaxLimit)
	shop, _ := s.st.Meta(ctx, "shop_name")

	type projectOut struct {
		store.Project
		Bom []store.BomLine `json:"bom"`
	}
	out := make([]projectOut, 0, len(projects))
	for _, p := range projects {
		lines, _ := s.st.Bom(ctx, p.PID)
		out = append(out, projectOut{Project: p, Bom: lines})
	}

	logPage, _ := s.st.Log(ctx, store.MaxLimit, 0)

	w.Header().Set("Content-Disposition", `attachment; filename="invos-export.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"exported": nowMilli(),
		"shopName": shop,
		"items":    all,
		"depts":    depts,
		"sections": secs,
		"projects": out,
		"log":      logPage.Rows,
		"counts":   counts,
	})
}

// ── the database file itself ────────────────────────────────────────────────

// downloadDB serves a consistent snapshot of the SQLite file. This is the "own your
// data" promise made literal: what comes back opens in DB Browser, sqlite3, Python or
// Excel, with no export format in between.
func (s *Server) downloadDB(w http.ResponseWriter, r *http.Request) {
	dir, err := os.MkdirTemp("", "invos-backup-*")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	defer os.RemoveAll(dir)

	dest := filepath.Join(dir, "invos.db")
	if err := s.st.Backup(r.Context(), dest); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	f, err := os.Open(dest)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	defer f.Close()

	name := fmt.Sprintf("invos-%s.db", time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	if fi, err := f.Stat(); err == nil {
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
	}
	io.Copy(w, f)
}

// ServerInfo describes this running station: where it listens, where its data is, and
// what a phone on the same network should type in to reach it.
type ServerInfo struct {
	Version   string   `json:"version"`
	DBPath    string   `json:"dbPath"`
	DBBytes   int64    `json:"dbBytes"`
	Port      int      `json:"port"`
	LAN       bool     `json:"lan"`
	URLs      []string `json:"urls"`
	TokenSet  bool     `json:"tokenSet"`
	StartedAt int64    `json:"startedAt"`
	// CanToggleLAN says whether the app may switch shop access on and off itself.
	CanToggleLAN bool `json:"canToggleLan"`
}

// Info is filled in by main() at startup; the UI reads it for the `server` screen.
var Info ServerInfo

func (s *Server) serverInfo(w http.ResponseWriter, r *http.Request) {
	info := Info
	info.DBPath = s.st.Path()
	if st, err := s.st.Stats(r.Context()); err == nil {
		info.DBBytes = st.DBBytes
	}
	info.TokenSet = s.Token != ""
	// LAN state is live, not whatever the flags said at startup — it can be toggled
	// from the app now.
	if s.LAN != nil {
		info.LAN = s.LAN.Enabled()
		info.URLs = append([]string{fmt.Sprintf("http://localhost:%d", info.Port)}, s.LAN.URLs()...)
		info.CanToggleLAN = true
	}
	writeJSON(w, http.StatusOK, info)
}
