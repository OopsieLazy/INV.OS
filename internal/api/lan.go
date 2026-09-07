package api

import (
	"errors"
	"net/http"
)

// LANControl turns shop-wide access on and off while the app is running.
//
// It is an interface because the listener belongs to main() — the API layer should be
// able to ask for the shop network to be opened without knowing how sockets are bound.
type LANControl interface {
	// Enabled reports whether the station is currently reachable from other devices.
	Enabled() bool
	// Enable starts listening on all interfaces. Safe to call when already enabled.
	Enable() error
	// Disable stops listening on all interfaces, leaving loopback alone. In-flight
	// requests from the shop finish; new ones cannot connect.
	Disable() error
	// URLs are the addresses a phone or tablet on the same network can open.
	URLs() []string
}

// routeLAN registers the runtime LAN switch.
func (s *Server) routeLAN(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/lan", s.setLAN)
}

func (s *Server) setLAN(w http.ResponseWriter, r *http.Request) {
	if s.LAN == nil {
		writeErr(w, http.StatusNotImplemented,
			errors.New("this build cannot change LAN access while running"))
		return
	}
	var body struct {
		On bool `json:"on"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	var err error
	if body.On {
		err = s.LAN.Enable()
	} else {
		err = s.LAN.Disable()
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"lan":  s.LAN.Enabled(),
		"urls": s.LAN.URLs(),
		// Worth saying out loud every time it is switched on: with no token, anyone
		// who can reach this machine on the network can edit the inventory.
		"unprotected": s.LAN.Enabled() && s.Token == "",
	})
}
