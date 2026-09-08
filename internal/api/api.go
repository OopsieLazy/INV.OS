// Package api exposes the Store over HTTP as JSON.
//
// This is the seam the shop's other devices talk to: the exe serves the UI and this
// API on the LAN, so a tablet at the bench and the PC in the office are looking at
// one database instead of two copies that drift apart.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"invos/internal/store"
)

// Server wires a Store and the embedded UI into one http.Handler.
type Server struct {
	st store.Store
	ui http.Handler
	// Token, when non-empty, is required as X-INVOS-Token on /api routes. It exists
	// for LAN deployments where the shop network is not trusted; it is not an account
	// system and is deliberately not one.
	Token string

	// lim is the per-client rate limiter, created on first use by rateLimit.
	lim *limiter
	// LAN, when set, lets the app open and close shop-wide access while running.
	LAN LANControl
}

// New builds the server. ui serves the embedded front-end.
func New(st store.Store, ui http.Handler) *Server { return &Server{st: st, ui: ui} }

// Handler returns the fully routed handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/stats", s.stats)

	mux.HandleFunc("GET /api/items", s.listItems)
	mux.HandleFunc("POST /api/items", s.addItem)
	mux.HandleFunc("POST /api/items/bulk", s.bulkAdd)
	mux.HandleFunc("GET /api/items/{cid}", s.getItem)
	mux.HandleFunc("PATCH /api/items/{cid}", s.patchItem)
	mux.HandleFunc("DELETE /api/items/{cid}", s.deleteItem)
	mux.HandleFunc("POST /api/items/{cid}/qty", s.adjustQty)

	mux.HandleFunc("GET /api/bins/next", s.nextBin)

	mux.HandleFunc("GET /api/depts", s.listDepts)
	mux.HandleFunc("PUT /api/depts/{n}", s.putDept)
	mux.HandleFunc("GET /api/sections", s.listSections)
	mux.HandleFunc("PUT /api/sections/{code}", s.putSection)

	mux.HandleFunc("GET /api/projects", s.listProjects)
	mux.HandleFunc("POST /api/projects", s.addProject)
	mux.HandleFunc("GET /api/projects/{pid}", s.getProject)
	mux.HandleFunc("PATCH /api/projects/{pid}", s.patchProject)
	mux.HandleFunc("DELETE /api/projects/{pid}", s.deleteProject)
	mux.HandleFunc("POST /api/projects/{pid}/active", s.activateProject)
	mux.HandleFunc("GET /api/projects/{pid}/bom", s.projectBom)
	mux.HandleFunc("POST /api/projects/{pid}/build", s.buildProject)
	mux.HandleFunc("PUT /api/projects/{pid}/bom/{cid}", s.putBomLine)
	mux.HandleFunc("DELETE /api/projects/{pid}/bom/{cid}", s.deleteBomLine)
	mux.HandleFunc("GET /api/shared-parts", s.sharedParts)

	mux.HandleFunc("GET /api/log", s.listLog)
	mux.HandleFunc("POST /api/undo", s.undo)

	mux.HandleFunc("GET /api/meta/{key}", s.getMeta)
	mux.HandleFunc("PUT /api/meta/{key}", s.putMeta)

	s.routeMaintenance(mux)
	s.routeLegacy(mux)
	s.routeLAN(mux)

	mux.Handle("/", s.ui)

	/* Order matters. Rate limiting is outermost so a flood is dropped before it costs
	   anything; then the same-origin check, then the token, then the app. Security
	   headers wrap the lot so even a refusal carries them. */
	return s.secure(s.logging(s.rateLimit(s.sameOrigin(s.auth(s.operator(mux))))))
}

// ── plumbing ────────────────────────────────────────────────────────────────

func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Token != "" && strings.HasPrefix(r.URL.Path, "/api/") &&
			!tokenOK(s.Token, r.Header.Get("X-INVOS-Token")) {
			writeErr(w, http.StatusUnauthorized, errors.New("bad or missing token"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

/* operator puts the caller's claimed name into the context, where appendLog picks it up
   without every mutation having to pass it along.

   Innermost in the chain on purpose: a request that is going to be refused for any other
   reason should be refused before this bothers to run, and nothing here is a security
   decision. The name is a claim, not a credential — see store.WithOperator. */
func (s *Server) operator(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if who := r.Header.Get("X-INVOS-Operator"); who != "" {
			r = r.WithContext(store.WithOperator(r.Context(), who))
		}
		next.ServeHTTP(w, r)
	})
}

// statusRecorder captures the status code so the access log reports the real result
// rather than assuming 200.
type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (r *statusRecorder) WriteHeader(c int) {
	r.code = c
	r.ResponseWriter.WriteHeader(c)
}

func (s *Server) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(rec, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			slog.Debug("api", "method", r.Method, "path", r.URL.Path,
				"status", rec.code, "ms", time.Since(start).Milliseconds())
		}
	})
}

// nowMilli is the timestamp format the whole app uses (JS Date.now()).
func nowMilli() int64 { return time.Now().UnixMilli() }

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "err", err)
	}
}

// writeErr maps a store error to a status code and a plain JSON body. The UI is a
// terminal, so the message is written to be shown to a person verbatim.
func writeErr(w http.ResponseWriter, code int, err error) {
	if errors.Is(err, store.ErrNotFound) {
		code = http.StatusNotFound
	}
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func intParam(r *http.Request, key string) (*int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return nil, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return nil, fmt.Errorf("%s must be a number, got %q", key, raw)
	}
	return &n, nil
}

func pathInt(r *http.Request, key string) (int64, error) {
	n, err := strconv.ParseInt(r.PathValue(key), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a number, got %q", key, r.PathValue(key))
	}
	return n, nil
}

// ── handlers ────────────────────────────────────────────────────────────────

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if _, err := s.st.Stats(r.Context()); err != nil {
		writeErr(w, http.StatusServiceUnavailable, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	st, err := s.st.Stats(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) listItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	iq := store.ItemQuery{
		Search: q.Get("q"),
		Sort:   q.Get("sort"),
		Desc:   q.Get("desc") == "1",
		LowSet: q.Get("low") == "1",
		// live search sends approx=1: top hits fast, "200+" instead of an exact total
		Approx: q.Get("approx") == "1",
	}
	for _, p := range []struct {
		key string
		dst **int
	}{{"bin", &iq.Bin}, {"dept", &iq.Dept}, {"sec", &iq.Sec}} {
		v, err := intParam(r, p.key)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		*p.dst = v
	}
	if v, err := intParam(r, "limit"); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	} else if v != nil {
		iq.Limit = *v
	}
	if v, err := intParam(r, "offset"); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	} else if v != nil {
		iq.Offset = *v
	}

	page, err := s.st.Items(r.Context(), iq)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) getItem(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	it, err := s.st.Item(r.Context(), cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, it)
}

func (s *Server) addItem(w http.ResponseWriter, r *http.Request) {
	var it store.Item
	if err := readJSON(r, &it); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(it.Name) == "" {
		writeErr(w, http.StatusBadRequest, errors.New("name is required"))
		return
	}
	if it.Bin < 0 || it.Bin > 9999 {
		writeErr(w, http.StatusBadRequest, errors.New("bin must be a 4-digit number"))
		return
	}
	out, err := s.st.AddItem(r.Context(), it)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// bulkAdd takes a whole spreadsheet (or the demo seed) in one request. It is a single
// transaction and a single undo step, so a bad import backs out in one action.
func (s *Server) bulkAdd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source string       `json:"source"`
		Items  []store.Item `json:"items"`
	}
	// A spreadsheet import is far larger than a normal request, so this route gets its
	// own body limit rather than the shared 1MB one.
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 64<<20))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	for i, it := range body.Items {
		if strings.TrimSpace(it.Name) == "" {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("row %d has no name", i+1))
			return
		}
		if it.Bin < 0 || it.Bin > 9999 {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("row %d has bin %d, must be 4 digits", i+1, it.Bin))
			return
		}
	}
	n, err := s.st.BulkAdd(r.Context(), body.Items, body.Source)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"added": n})
}

func (s *Server) patchItem(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var patch map[string]any
	if err := readJSON(r, &patch); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	// JSON numbers decode as float64; the columns they land in are integers.
	for _, k := range []string{"bin", "qty", "min"} {
		if f, ok := patch[k].(float64); ok {
			patch[k] = int(f)
		}
	}
	out, err := s.st.UpdateItem(r.Context(), cid, patch)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) deleteItem(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.DeleteItem(r.Context(), cid); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adjustQty(w http.ResponseWriter, r *http.Request) {
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var body struct {
		Delta int `json:"delta"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if body.Delta == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("delta must be non-zero"))
		return
	}
	out, err := s.st.AdjustQty(r.Context(), cid, body.Delta)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) nextBin(w http.ResponseWriter, r *http.Request) {
	dept, err := intParam(r, "dept")
	if err != nil || dept == nil {
		writeErr(w, http.StatusBadRequest, errors.New("dept is required"))
		return
	}
	sec, err := intParam(r, "sec")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	d := 0
	if sec != nil {
		d = *sec
	}
	bin, err := s.st.NextFreeBin(r.Context(), *dept, d)
	if err != nil {
		writeErr(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"bin": bin})
}

func (s *Server) listDepts(w http.ResponseWriter, r *http.Request) {
	d, err := s.st.Depts(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) putDept(w http.ResponseWriter, r *http.Request) {
	n, err := pathInt(r, "n")
	if err != nil || n < 0 || n > 9 {
		writeErr(w, http.StatusBadRequest, errors.New("department must be 0-9"))
		return
	}
	var body struct {
		Label string `json:"label"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.SetDept(r.Context(), int(n), body.Label); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"n": n, "label": body.Label})
}

func (s *Server) listSections(w http.ResponseWriter, r *http.Request) {
	dept := -1 // all departments
	if v, err := intParam(r, "dept"); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	} else if v != nil {
		dept = *v
	}
	secs, err := s.st.Sections(r.Context(), dept)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, secs)
}

func (s *Server) putSection(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Label string `json:"label"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	// an empty label clears the shelf, which the store refuses while it holds items
	if err := s.st.SetSection(r.Context(), r.PathValue("code"), body.Label); err != nil {
		writeErr(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": r.PathValue("code"), "label": body.Label})
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	p, err := s.st.Projects(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) projectBom(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	lines, err := s.st.Bom(r.Context(), pid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, lines)
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	p, err := s.st.Project(r.Context(), pid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) addProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeErr(w, http.StatusBadRequest, errors.New("a project needs a name"))
		return
	}
	p, err := s.st.AddProject(r.Context(), strings.TrimSpace(body.Name))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) patchProject(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var patch map[string]any
	if err := readJSON(r, &patch); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	p, err := s.st.UpdateProject(r.Context(), pid, patch)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.DeleteProject(r.Context(), pid); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// activateProject makes one build the active one. Posting pid 0 clears the selection.
func (s *Server) activateProject(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.SetActiveProject(r.Context(), pid); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"active": pid})
}

func (s *Server) putBomLine(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var body struct {
		Need int `json:"need"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.SetBomLine(r.Context(), pid, cid, body.Need); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	lines, err := s.st.Bom(r.Context(), pid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, lines)
}

func (s *Server) deleteBomLine(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	cid, err := pathInt(r, "cid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.RemoveBomLine(r.Context(), pid, cid); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sharedParts feeds the galaxy view's bridges between project clusters.
func (s *Server) sharedParts(w http.ResponseWriter, r *http.Request) {
	sp, err := s.st.SharedParts(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, sp)
}

// buildProject consumes a project's BOM in one transaction. A shortage comes back as
// 409 with the lines that are short, so the terminal can list them.
func (s *Server) buildProject(w http.ResponseWriter, r *http.Request) {
	pid, err := pathInt(r, "pid")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var body struct {
		Partial bool `json:"partial"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	taken, short, err := s.st.BuildProject(r.Context(), pid, body.Partial)
	if store.ErrShort(err) {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "not enough stock", "short": short,
		})
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"taken": taken, "short": short})
}

func (s *Server) listLog(w http.ResponseWriter, r *http.Request) {
	limit, offset := 20, 0
	if v, err := intParam(r, "limit"); err == nil && v != nil {
		limit = *v
	}
	if v, err := intParam(r, "offset"); err == nil && v != nil {
		offset = *v
	}
	q := store.LogQuery{Limit: limit, Offset: offset, Operator: r.URL.Query().Get("by")}
	if v, err := intParam(r, "cid"); err == nil && v != nil {
		cid := int64(*v)
		q.CID = &cid
	}
	page, err := s.st.Log(r.Context(), q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) undo(w http.ResponseWriter, r *http.Request) {
	e, err := s.st.Undo(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"undone": false, "reason": "nothing left to undo"})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"undone": true, "entry": e})
}

func (s *Server) getMeta(w http.ResponseWriter, r *http.Request) {
	v, err := s.st.Meta(r.Context(), r.PathValue("key"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": r.PathValue("key"), "value": v})
}

func (s *Server) putMeta(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Value string `json:"value"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.st.SetMeta(r.Context(), r.PathValue("key"), body.Value); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": r.PathValue("key"), "value": body.Value})
}
