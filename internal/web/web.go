// Package web carries the front-end inside the binary.
//
// Everything under ui/ is compiled into the exe, so the product ships as one file
// with nothing to unpack and no folder a customer can half-delete.
package web

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
)

//go:embed ui
var files embed.FS

// Handler serves the embedded UI at the site root.
func Handler() http.Handler {
	sub, err := fs.Sub(files, "ui")
	if err != nil {
		// Unreachable: the directory is embedded at compile time, so a failure here
		// means the binary itself is malformed.
		panic("embedded ui missing: " + err.Error())
	}
	return noCache(http.FileServer(http.FS(sub)))
}

// noCache wraps the UI handler so the browser always revalidates against this process.
//
// The app is served over loopback by the program that owns the data, so caching the
// shell saves nothing measurable and costs correctness: a stale index.html means a user
// running a fixed build still sees the bug. Re-fetching a couple hundred kilobytes from
// a local socket is not a cost worth trading a wrong screen for.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		h.ServeHTTP(w, r)
	})
}

// buildID is a short fingerprint of the UI this binary carries. It changes whenever the
// UI changes, without anyone having to remember to bump a version.
//
// It exists because "am I looking at the new build?" cost real debugging time twice: a
// page that is already open does not reload itself when the server behind it is
// replaced, so a fixed bug looks unfixed. The app compares this against the server's
// value and says so.
var buildID = func() string {
	data, err := files.ReadFile("ui/index.html")
	if err != nil {
		return "unknown"
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:4])
}()

// BuildID returns the fingerprint of the embedded UI.
func BuildID() string { return buildID }
