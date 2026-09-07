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
	return http.FileServer(http.FS(sub))
}
