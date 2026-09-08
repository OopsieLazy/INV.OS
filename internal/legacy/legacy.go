// Package legacy reads inventories written by the v20.2 single-file HTML build.
//
// That build kept the WHOLE inventory as one JSON blob and wrote it to several places,
// so "an old export" arrives in more than one shape:
//
//	the file the download button produced   — the bare state object
//	the checksummed envelope                — {v, ts, sum, data:"<the state, as a string>"}
//	an invos.db written by the sql.js mirror — the same envelope or state, in state.blob
//	a blob-server response                   — {blob:"<...>", updated_at}
//
// All four end at the same object, so this unwraps until it finds it rather than asking
// the caller which one they have. Parsing lives here and not in internal/store because
// the store's one job is SQL; reading someone else's file format is not that.
package legacy

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"invos/internal/store"
)

// maxUnwrap bounds the envelope-in-envelope search. Three is one more than any real
// file needs; the limit is here so a hand-edited or hostile file cannot loop forever.
const maxUnwrap = 3

// Parse reads any of the shapes above and returns what the shop actually had.
func Parse(data []byte) (store.LegacySnapshot, error) {
	var snap store.LegacySnapshot

	raw := data
	for i := 0; ; i++ {
		var probe map[string]json.RawMessage
		if err := json.Unmarshal(raw, &probe); err != nil {
			return snap, fmt.Errorf("this is not a JSON export: %w", err)
		}
		// An envelope carries the real state as a STRING under data/blob/state.
		inner, ok := unwrap(probe)
		if !ok {
			return decode(raw)
		}
		if i >= maxUnwrap {
			return snap, fmt.Errorf("export is wrapped more than %d deep; it is probably not an INV.OS file", maxUnwrap)
		}
		raw = inner
	}
}

func unwrap(probe map[string]json.RawMessage) ([]byte, bool) {
	// items present means this IS the state, even if it also has a data/blob key
	if _, isState := probe["items"]; isState {
		return nil, false
	}
	for _, k := range []string{"data", "blob", "state"} {
		v, ok := probe[k]
		if !ok {
			continue
		}
		var s string
		if err := json.Unmarshal(v, &s); err == nil && strings.TrimSpace(s) != "" {
			return []byte(s), true
		}
		// some writers nested the object directly rather than as a string
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(v, &obj); err == nil {
			if _, has := obj["items"]; has {
				return v, true
			}
		}
	}
	return nil, false
}

// legacyState mirrors the old `state` object. Only the fields worth carrying over are
// listed: display preferences are per-device and deliberately not imported.
type legacyState struct {
	Items []struct {
		CID   int64           `json:"cid"`
		Name  string          `json:"name"`
		Bin   json.RawMessage `json:"bin"`
		Qty   json.RawMessage `json:"qty"`
		Min   json.RawMessage `json:"min"`
		Value string          `json:"value"`
		Pkg   string          `json:"pkg"`
		Part  string          `json:"part"`
		Sup   string          `json:"supplier"`
		Src   string          `json:"source"`
		Link  string          `json:"link"`
		Notes string          `json:"notes"`
	} `json:"items"`
	Projects []struct {
		PID     int64  `json:"pid"`
		Name    string `json:"name"`
		Notes   string `json:"notes"`
		Status  string `json:"status"`
		Created int64  `json:"created"`
		Bom     []struct {
			CID  int64           `json:"cid"`
			Need json.RawMessage `json:"need"`
		} `json:"bom"`
	} `json:"projects"`
	Active   json.RawMessage   `json:"activeProject"`
	Classes  []string          `json:"classes"`
	Sections map[string]string `json:"sections"`
	Counted  map[string]int64  `json:"counted"`
}

func decode(raw []byte) (store.LegacySnapshot, error) {
	var snap store.LegacySnapshot
	var st legacyState
	if err := json.Unmarshal(raw, &st); err != nil {
		return snap, fmt.Errorf("export is JSON but not an inventory: %w", err)
	}
	if len(st.Items) == 0 && len(st.Projects) == 0 {
		return snap, fmt.Errorf("no items and no projects in this file")
	}

	active := num(st.Active)
	seen := map[int64]bool{}
	for _, o := range st.Items {
		// A row with no name or no CID cannot be filed against a physical drawer, and
		// silently inventing either is worse than saying so.
		if o.CID <= 0 || strings.TrimSpace(o.Name) == "" {
			snap.Skipped = append(snap.Skipped,
				fmt.Sprintf("item %q has no usable cid/name", o.Name))
			continue
		}
		if seen[o.CID] {
			snap.Skipped = append(snap.Skipped, fmt.Sprintf("C-%04d appears twice", o.CID))
			continue
		}
		seen[o.CID] = true
		it := store.Item{
			CID: o.CID, Name: strings.TrimSpace(o.Name),
			Bin: int(num(o.Bin)), Qty: int(num(o.Qty)), Min: int(num(o.Min)),
			Value: o.Value, Pkg: o.Pkg, Part: o.Part,
			Supplier: o.Sup, Source: o.Src, Link: o.Link, Notes: o.Notes,
		}
		if ts, ok := st.Counted[strconv.FormatInt(o.CID, 10)]; ok && ts > 0 {
			t := ts
			it.CountedAt = &t
		}
		snap.Items = append(snap.Items, it)
	}

	pseen := map[int64]bool{}
	for _, p := range st.Projects {
		if p.PID <= 0 || strings.TrimSpace(p.Name) == "" {
			snap.Skipped = append(snap.Skipped, fmt.Sprintf("project %q has no usable pid/name", p.Name))
			continue
		}
		if pseen[p.PID] {
			snap.Skipped = append(snap.Skipped, fmt.Sprintf("project %d appears twice", p.PID))
			continue
		}
		pseen[p.PID] = true
		lp := store.LegacyProject{
			PID: p.PID, Name: strings.TrimSpace(p.Name), Notes: p.Notes,
			Status: status(p.Status), Created: p.Created, Active: active == p.PID,
		}
		for _, b := range p.Bom {
			need := int(num(b.Need))
			// A BOM line pointing at an item that is not in the file would be a
			// dangling row; the old build allowed it, the schema here does not.
			if b.CID <= 0 || need <= 0 || !seen[b.CID] {
				snap.Skipped = append(snap.Skipped,
					fmt.Sprintf("%s: BOM line for C-%04d dropped (missing part or zero need)", lp.Name, b.CID))
				continue
			}
			lp.Bom = append(lp.Bom, store.LegacyBom{CID: b.CID, Need: need})
		}
		snap.Projects = append(snap.Projects, lp)
	}

	snap.Depts = map[int]string{}
	for i, label := range st.Classes {
		if strings.TrimSpace(label) != "" {
			snap.Depts[i] = label
		}
	}
	snap.Sections = map[string]string{}
	for code, label := range st.Sections {
		if strings.TrimSpace(label) != "" {
			snap.Sections[code] = label
		}
	}
	return snap, nil
}

func status(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "building", "done":
		return strings.ToLower(strings.TrimSpace(s))
	default:
		return "planning"
	}
}

// num reads a value the old build might have stored as either a number or a string —
// hand-edited exports and older writers did both.
func num(raw json.RawMessage) int64 {
	if len(raw) == 0 {
		return 0
	}
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil {
		return int64(f)
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if n, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil {
			return int64(n)
		}
	}
	return 0
}
