// Package web carries the front-end inside the binary.
//
// Everything under ui/ is compiled into the exe, so the product ships as one file
// with nothing to unpack and no folder a customer can half-delete.
package web

import (
	"embed"
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
