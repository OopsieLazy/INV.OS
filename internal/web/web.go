// Package web carries the front-end inside the binary.
//
// Everything under ui/ is compiled into the exe, so the product ships as one file
// with nothing to unpack and no folder a customer can half-delete.
package web

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
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
	return noCache(gzipped(http.FileServer(http.FS(sub))))
}

/*
The UI is one 288KB HTML file and it compresses to about a fifth of that. Over

	loopback nobody would notice, but shop access means a tablet pulling it across wifi,
	and that is where a quarter of a megabyte per page load is felt.

	It is compressed ONCE, at startup, rather than per request: the file never changes
	during a run, so re-compressing it for every device would be work done repeatedly to
	produce a byte-identical answer. Anything not pre-compressed here — icons, the
	manifest — falls through to the normal handler untouched.
*/
var precompressed = buildPrecompressed()

func buildPrecompressed() map[string][]byte {
	out := map[string][]byte{}
	for _, name := range []string{"ui/index.html", "ui/manifest.webmanifest"} {
		raw, err := files.ReadFile(name)
		if err != nil {
			continue
		}
		var buf bytes.Buffer
		zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		if err != nil {
			continue
		}
		if _, err := zw.Write(raw); err != nil || zw.Close() != nil {
			continue
		}
		// Only keep it if it actually helped; a compressed copy that is bigger than the
		// original is worse than none.
		if buf.Len() < len(raw) {
			out[strings.TrimPrefix(name, "ui")] = buf.Bytes()
		}
	}
	return out
}

func gzipped(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		body, ok := precompressed[path]
		if !ok || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Set("Content-Encoding", "gzip")
		// Without this a proxy or a browser cache could hand the compressed bytes to a
		// client that said it could not read them.
		h.Add("Vary", "Accept-Encoding")
		h.Set("Content-Type", contentType(path))
		h.Set("Content-Length", strconv.Itoa(len(body)))
		if r.Method == http.MethodHead {
			return
		}
		w.Write(body)
	})
}

func contentType(path string) string {
	if strings.HasSuffix(path, ".webmanifest") {
		return "application/manifest+json"
	}
	return "text/html; charset=utf-8"
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
