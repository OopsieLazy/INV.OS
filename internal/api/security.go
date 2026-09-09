package api

import (
	"crypto/subtle"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

/* Security middleware.

   The threat this is written against is not a determined attacker on the internet — the
   app is not on the internet. It is the shop's own network: a laptop someone brought in, a
   phone on the guest wifi, a machine that picked something up. The station must not become
   a way for any of those to reach the inventory, and it must not hand out anything about
   the machine it runs on.

   Everything here applies to LAN and localhost alike. A rule that is only on when you
   remember to switch it on is a rule that is off. */

// ── security headers ────────────────────────────────────────────────────────

/*
The UI is entirely self-contained — no CDN, no external font, no analytics, and no

	eval — so it can be locked down about as hard as a browser allows.

	'unsafe-inline' is present because the interface IS one inline script and one inline
	style block; that is the single-file design, not an oversight. Everything that would
	let injected markup reach outward is off: no frames, no plugins, no form posts, no base
	rewriting, and connect-src is same-origin so a script that did get in could not send
	the inventory anywhere.
*/
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"media-src 'self' blob:; " +
	"font-src 'self' data:; " +
	"connect-src 'self'; " +
	"worker-src 'self' blob:; " +
	"object-src 'none'; " +
	"base-uri 'none'; " +
	"form-action 'none'; " +
	"frame-ancestors 'none'"

func (s *Server) secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		// The scanner needs the camera; nothing here needs anything else.
		h.Set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), "+
			"payment=(), usb=(), interest-cohort=()")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")

		// HSTS only over TLS. Sending it on plain HTTP is meaningless, and on a LAN
		// hostname it would poison every other service on that host for months.
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

// ── cross-site request forgery ──────────────────────────────────────────────

/*
A page on another site cannot READ our responses — there are no CORS headers, so the

	browser blocks that. It can still SEND, and that is the hole worth closing: a tab open
	on any site could POST to http://192.168.1.40:8137/api/items and change the shop's
	inventory without ever seeing a reply.

	Two checks, because browsers of different ages give us different things:

	  Sec-Fetch-Site  modern, and the browser sets it — a page cannot lie about it.
	  Origin          older, and absent on same-origin navigations, hence the fallback.

	Only state-changing methods are guarded. A GET that changes nothing is not worth the
	compatibility risk, and none of ours do.
*/
func (s *Server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		switch r.Header.Get("Sec-Fetch-Site") {
		case "same-origin", "none":
			next.ServeHTTP(w, r)
			return
		case "cross-site", "same-site":
			writeErr(w, http.StatusForbidden,
				errors.New("cross-site request refused"))
			return
		}

		// No Sec-Fetch-Site: an older browser, or a non-browser client such as curl or
		// the test harness. An Origin that does not match ours is still refused; a
		// missing one is allowed through, because a tool that is not a browser has no
		// reason to send one and is not the thing CSRF protects against.
		if origin := r.Header.Get("Origin"); origin != "" && !s.originIsOurs(origin, r) {
			writeErr(w, http.StatusForbidden, errors.New("cross-site request refused"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) originIsOurs(origin string, r *http.Request) bool {
	// Compare hosts, not whole URLs: the station is legitimately reached by several
	// addresses at once — localhost, its LAN IP, its hostname.
	i := strings.Index(origin, "://")
	if i < 0 {
		return false
	}
	oh := origin[i+3:]
	if h, _, err := net.SplitHostPort(oh); err == nil {
		oh = h
	}
	rh := r.Host
	if h, _, err := net.SplitHostPort(rh); err == nil {
		rh = h
	}
	return strings.EqualFold(oh, rh)
}

// ── rate limiting ───────────────────────────────────────────────────────────

/*
A token bucket per client address.

	The limit is deliberately loose. A person using the app hard — typing into live search,
	paging a long list, opening the graph — makes a lot of requests in a short burst, and a
	limit that interrupts real work would be worse than no limit at all. What this stops is
	the other thing: a script hammering the station, whether that is someone probing it or
	a device stuck in a retry loop taking the shop's inventory down with it.
*/
const (
	rateBurst   = 240             // requests available immediately
	ratePerSec  = 40              // and how fast the bucket refills
	rateSweepAt = 5 * time.Minute // forget clients that have gone away
)

type bucket struct {
	tokens float64
	seen   time.Time
}

type limiter struct {
	mu      sync.Mutex
	clients map[string]*bucket
	swept   time.Time
}

func newLimiter() *limiter {
	return &limiter{clients: map[string]*bucket{}, swept: time.Now()}
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Sweeping here rather than on a timer keeps the map from growing without bound on
	// a station that has been up for months, with no goroutine to own.
	if now.Sub(l.swept) > rateSweepAt {
		for k, b := range l.clients {
			if now.Sub(b.seen) > rateSweepAt {
				delete(l.clients, k)
			}
		}
		l.swept = now
	}

	b := l.clients[key]
	if b == nil {
		b = &bucket{tokens: rateBurst, seen: now}
		l.clients[key] = b
	}
	b.tokens += now.Sub(b.seen).Seconds() * ratePerSec
	if b.tokens > rateBurst {
		b.tokens = rateBurst
	}
	b.seen = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (s *Server) rateLimit(next http.Handler) http.Handler {
	if s.lim == nil {
		s.lim = newLimiter()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.lim.allow(clientIP(r), time.Now()) {
			w.Header().Set("Retry-After", "1")
			writeErr(w, http.StatusTooManyRequests,
				errors.New("too many requests — slow down"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP is the remote address with the port stripped. Proxy headers are deliberately
// NOT trusted: this serves a LAN directly, so X-Forwarded-For here would be a value the
// caller chose for itself, and honouring it would let anyone opt out of the rate limit.
func clientIP(r *http.Request) string {
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return h
	}
	return r.RemoteAddr
}

// ── token comparison ────────────────────────────────────────────────────────

// tokenOK compares in constant time. A plain != returns as soon as two bytes differ, and
// the time that takes is measurable over a network — enough to recover a token one
// character at a time.
func tokenOK(want, got string) bool {
	return subtle.ConstantTimeCompare([]byte(want), []byte(got)) == 1
}

// isLocal reports whether a request came from the machine itself, which is how the
// station tells "the person sitting here" from "a device on the shop wifi".
func isLocal(r *http.Request) bool {
	ip := net.ParseIP(clientIP(r))
	return ip != nil && ip.IsLoopback()
}

/*
── the station must not become a way in ───────────────────────────────────

	This app is meant to be reachable by the shop's own tablets and by nothing else. The
	realistic way that goes wrong is not an attacker picking a lock: it is the station
	ending up on the open internet by accident — a router with UPnP on, a port forward
	somebody set up for something else years ago, a "cloud" VPS someone runs it on to try
	it. In every one of those the inventory is suddenly answering strangers.

	So the address a request came FROM is checked, and anything that is not the local
	network is refused before it reaches a handler. Nobody who is meant to be using this
	is ever outside RFC1918.

	-open-to-internet exists because refusing to run somewhere is worse than refusing by
	default and being told how to override it. It is loud, on purpose.
*/
func isPrivateClient(r *http.Request) bool {
	ip := net.ParseIP(clientIP(r))
	if ip == nil {
		// An address that will not parse is not one we can vouch for.
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func (s *Server) privateOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.OpenToInternet || isPrivateClient(r) {
			next.ServeHTTP(w, r)
			return
		}
		// Deliberately terse and deliberately logged: the shop wants to know this
		// happened, and whoever is knocking gets nothing to work with.
		slog.Warn("refused a request from outside the local network",
			"from", clientIP(r), "path", r.URL.Path)
		http.Error(w, "this station only serves its own local network", http.StatusForbidden)
	})
}
