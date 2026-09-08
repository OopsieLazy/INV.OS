package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"invos/internal/legacy"
	"invos/internal/store"
)

// routeLegacy adds the one route that moves a shop off the old HTML build.
func (s *Server) routeLegacy(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/import/legacy", s.importLegacy)
}

/* POST /api/import/legacy

   Takes the export one of two ways, because the two old formats cannot both arrive the
   same route:

     {"content":"<the export JSON>"}   the browser read the file, which it can do for
                                       the .json the old download button produced
     {"path":"C:/.../invos.db"}        a file on the machine running the server, which
                                       is the only way to reach an old sql.js .db —
                                       a browser cannot open a SQLite file

   `dry` reports what WOULD happen without writing, so a shop can look before it leaps. */
func (s *Server) importLegacy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content string `json:"content"`
		Path    string `json:"path"`
		Dry     bool   `json:"dry"`
	}
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 64<<20))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	raw := []byte(body.Content)
	if body.Path != "" {
		var err error
		if raw, err = readLegacyFile(body.Path); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("no file contents and no path"))
		return
	}

	snap, err := legacy.Parse(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	if body.Dry {
		writeJSON(w, http.StatusOK, store.LegacyResult{
			Items:    len(snap.Items),
			Projects: len(snap.Projects),
			BomLines: countBom(snap),
			Depts:    len(snap.Depts),
			Sections: len(snap.Sections),
			Skipped:  snap.Skipped,
		})
		return
	}

	res, err := s.st.ImportLegacy(r.Context(), snap)
	if err != nil {
		// A CID collision is the caller's situation, not a server fault.
		writeErr(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

// readLegacyFile reads either the old JSON export or an old sql.js database, deciding by
// content rather than by extension — the file has often been renamed by the time it gets
// here, and guessing from ".db" would fail on a JSON file called backup.db.
func readLegacyFile(path string) ([]byte, error) {
	path = filepath.Clean(path)
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("cannot open %s: %w", path, err)
	}
	head := make([]byte, 16)
	n, _ := f.Read(head)
	f.Close()

	// Every SQLite file starts with this exact string.
	if n >= 15 && string(head[:15]) == "SQLite format 3" {
		blob, err := store.LegacyBlob(path)
		if err != nil {
			return nil, err
		}
		return []byte(blob), nil
	}
	return os.ReadFile(path)
}

func countBom(snap store.LegacySnapshot) int {
	n := 0
	for _, p := range snap.Projects {
		n += len(p.Bom)
	}
	return n
}
