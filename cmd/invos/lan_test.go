package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// freePort returns a port nothing is listening on. There is an unavoidable gap between
// closing this listener and the test binding it again; on a machine running tests that
// is not worth defending against.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("could not find a free port: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "inv.os")
	})
}

/*
TestEnableAlongsideLoopback is the regression test for the bug that stopped `invos -lan`
starting on Linux at all.

	main() listens on 127.0.0.1:<port> and keeps that listener up for the life of the
	process. The shop switch then opened a SECOND listener, and it used a wildcard
	address (0.0.0.0). Linux refuses that: a wildcard bind conflicts with any specific
	address already in LISTEN state on the same port, and SO_REUSEADDR does not waive it
	because the exemption only applies when the existing socket is not listening. So
	Enable always failed with "address already in use" — the station colliding with
	itself — and systemd restarted it forever.

	Windows allows the overlap, so this passes there whether the bug is present or not.
	It is a Linux regression test that happens to be portable.
*/
func TestEnableAlongsideLoopback(t *testing.T) {
	port := freePort(t)

	// Stand in for main()'s always-up loopback listener.
	loopback, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatalf("loopback listener: %v", err)
	}
	defer loopback.Close()

	l := newLANSwitch(port, okHandler())
	if err := l.Enable(); err != nil {
		t.Fatalf("Enable with loopback already bound on the same port: %v", err)
	}
	defer l.Disable()

	if !l.Enabled() {
		t.Fatal("Enable returned nil but the switch reports off")
	}
}

// TestEnableBindsEveryAdvertisedAddress checks the property that makes the per-address
// design safe: the station never prints a URL it is not actually listening on.
func TestEnableBindsEveryAdvertisedAddress(t *testing.T) {
	ips := lanIPs()
	if len(ips) == 0 {
		t.Skip("no non-loopback addresses on this machine")
	}
	port := freePort(t)

	loopback, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatalf("loopback listener: %v", err)
	}
	defer loopback.Close()

	l := newLANSwitch(port, okHandler())
	if err := l.Enable(); err != nil {
		t.Fatalf("Enable: %v", err)
	}
	defer l.Disable()

	client := &http.Client{Timeout: 3 * time.Second}
	for _, ip := range ips {
		url := "http://" + net.JoinHostPort(ip, strconv.Itoa(port)) + "/"
		resp, err := client.Get(url)
		if err != nil {
			t.Errorf("advertised %s but nothing answers there: %v", url, err)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if string(body) != "inv.os" {
			t.Errorf("%s served %q, want %q", url, body, "inv.os")
		}
	}
}

// TestDisableFreesEveryAddress: "off" has to mean off, on every address, or the next
// Enable fails to rebind and shop access silently half-works.
func TestDisableFreesEveryAddress(t *testing.T) {
	port := freePort(t)
	l := newLANSwitch(port, okHandler())
	if err := l.Enable(); err != nil {
		t.Fatalf("Enable: %v", err)
	}
	if err := l.Disable(); err != nil {
		t.Fatalf("Disable: %v", err)
	}
	if l.Enabled() {
		t.Fatal("still enabled after Disable")
	}
	// Rebinding the same addresses is the proof the listeners actually closed.
	if err := l.Enable(); err != nil {
		t.Fatalf("could not re-Enable after Disable — listeners were not released: %v", err)
	}
	l.Disable()
}

// TestRebindIsIdempotent guards the watcher: a tick that finds no change must not churn
// listeners, because closing and reopening one drops whoever was connected through it.
func TestRebindIsIdempotent(t *testing.T) {
	port := freePort(t)
	l := newLANSwitch(port, okHandler())
	if err := l.Enable(); err != nil {
		t.Fatalf("Enable: %v", err)
	}
	defer l.Disable()

	l.mu.Lock()
	before := make(map[string]net.Listener, len(l.lns))
	for ip, ln := range l.lns {
		before[ip] = ln
	}
	l.rebindLocked()
	after := l.lns
	l.mu.Unlock()

	if len(before) != len(after) {
		t.Fatalf("rebind changed the listener count: %d -> %d", len(before), len(after))
	}
	for ip, ln := range before {
		if after[ip] != ln {
			t.Errorf("rebind replaced the listener for %s with no address change", ip)
		}
	}
}
