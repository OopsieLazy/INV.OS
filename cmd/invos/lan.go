package main

import (
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// lanRebindInterval is how often the shop listener re-checks this machine's addresses.
// Addresses are not static: DHCP hands out a new one, Wi-Fi replaces Ethernet, and
// `tailscale up` adds a 100.x address minutes after boot. Polling is deliberate — there
// is no interface-change notification that works on Linux, macOS and Windows alike, and
// a ten-second tick over a handful of interfaces costs nothing measurable.
const lanRebindInterval = 10 * time.Second

// lanSwitch opens and closes shop-wide access while the app is running.
//
// The loopback listener is always up, so the station itself never loses the app. This
// adds listeners on the machine's OTHER addresses, which is what shop devices connect
// to. Separate listeners rather than rebinding one means flipping the switch never
// interrupts the person standing at the machine.
//
// One listener PER ADDRESS, not a single wildcard one. A wildcard bind (0.0.0.0) is the
// obvious way to write this and it does not work here: on Linux the kernel refuses to
// bind a wildcard while a specific address on that port is already in LISTEN state, and
// main() is by then listening on 127.0.0.1. SO_REUSEADDR does not lift that — the
// exemption only applies when the existing socket is not listening. So `invos -lan` died
// at startup on every Linux box with "address already in use", reporting a collision
// with its own loopback listener. Windows permits the overlap, which is why it survived
// development. Binding each address on its own leaves loopback alone and works on both.
//
// The shop listeners share their OWN http.Server, and that is not an implementation
// detail: closing a listener only stops NEW connections, and a tablet holding a
// keep-alive connection would carry on being served after the switch was thrown. A
// separate server can be Closed, which drops every listener and every connection on
// them. "Off" has to actually mean off.
type lanSwitch struct {
	mu      sync.Mutex
	port    int
	handler http.Handler
	srv     *http.Server // nil when shop access is off

	// lns is one listener per bound address, keyed by IP, so the watcher can tell which
	// addresses it already has and which have gone away.
	lns map[string]net.Listener
	// stop ends the address watcher. Closed by Disable; nil when access is off.
	stop chan struct{}

	// tlsCfg, when set, encrypts shop access. Loopback is left on plain HTTP: it never
	// touches a wire, and a certificate warning on the station's own screen every
	// morning would teach the shop to click through certificate warnings.
	tlsCfg *tls.Config
	// baseTLS is the certificate this station loaded at startup, kept so encryption can
	// be switched back ON after being switched off without restarting.
	baseTLS *tls.Config
}

func newLANSwitch(port int, handler http.Handler) *lanSwitch {
	return &lanSwitch{port: port, handler: handler}
}

func (l *lanSwitch) Enabled() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.srv != nil
}

func (l *lanSwitch) Enable() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.srv != nil {
		return nil
	}
	// A closed http.Server cannot be reused, so each time shop access is opened it
	// gets a fresh one.
	l.srv = &http.Server{
		Handler:           l.handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	l.lns = make(map[string]net.Listener)

	/* The addresses to bind are exactly the ones the app will TELL people to type, so
	   the station cannot advertise a URL it is not listening on. */
	ips := lanIPs()
	l.rebindLocked()
	if len(l.lns) == 0 && len(ips) > 0 {
		l.srv, l.lns = nil, nil
		return fmt.Errorf("could not open port %d on any of this machine's addresses (%s) — is another copy already running?",
			l.port, strings.Join(ips, ", "))
	}

	/* No addresses is NOT an error: a box that boots before its network, or before
	   `tailscale up` has run, has nothing to bind yet. Shop access is on, and the
	   watcher opens a listener the moment an address appears. */
	l.stop = make(chan struct{})
	go l.watch(l.stop)

	slog.Info("shop access on", "port", l.port, "addresses", len(l.lns))
	return nil
}

// watch keeps the bound addresses matching the machine's actual addresses, so a station
// that changes network — or joins a tailnet an hour after boot — starts answering there
// without anyone restarting it.
func (l *lanSwitch) watch(stop <-chan struct{}) {
	t := time.NewTicker(lanRebindInterval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			l.mu.Lock()
			l.rebindLocked()
			l.mu.Unlock()
		}
	}
}

// rebindLocked drops listeners whose address has gone and opens listeners for addresses
// that have appeared. Caller holds l.mu.
func (l *lanSwitch) rebindLocked() {
	if l.srv == nil {
		return
	}
	want := make(map[string]bool)
	for _, ip := range lanIPs() {
		want[ip] = true
	}
	for ip, ln := range l.lns {
		if want[ip] {
			continue
		}
		ln.Close()
		delete(l.lns, ip)
		slog.Info("shop address gone", "ip", ip)
	}
	for ip := range want {
		if _, ok := l.lns[ip]; ok {
			continue
		}
		if err := l.bindLocked(ip); err != nil {
			// Someone else on this address+port, or an address that vanished between
			// the enumeration and the bind. Neither is worth taking the station down.
			slog.Debug("could not open shop listener", "ip", ip, "err", err)
			continue
		}
		slog.Info("shop address added", "ip", ip, "port", l.port)
	}
}

// bindLocked opens one listener and starts serving it. Caller holds l.mu.
func (l *lanSwitch) bindLocked(ip string) error {
	ln, err := net.Listen("tcp", net.JoinHostPort(ip, strconv.Itoa(l.port)))
	if err != nil {
		return err
	}
	if l.tlsCfg != nil {
		ln = tls.NewListener(ln, l.tlsCfg)
	}
	l.lns[ip] = ln
	srv := l.srv
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Debug("shop listener stopped", "ip", ip, "err", err)
		}
	}()
	return nil
}

// Disable closes every shop listener AND every connection on them, so a device that was
// already talking to the station is cut off rather than quietly kept alive.
func (l *lanSwitch) Disable() error {
	l.mu.Lock()
	srv, stop := l.srv, l.stop
	l.srv, l.lns, l.stop = nil, nil, nil
	l.mu.Unlock()

	if srv == nil {
		return nil
	}
	close(stop) // stop the watcher before it can rebind what we are about to close
	err := srv.Close()
	slog.Info("shop access off")
	return err
}

// URLs lists what a phone or tablet on the same network should open. Empty when shop
// access is off, because there is nothing to type in.
// Secure reports whether shop access is currently encrypted.
func (l *lanSwitch) Secure() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.tlsCfg != nil
}

/*
SetSecure switches shop access between https and plain http while running.

	The listener has to be rebuilt, because TLS is decided when the socket is wrapped and
	not per request. Anything currently connected is dropped — which is the honest
	behaviour: a tablet holding an https connection cannot be quietly moved to http, and
	pretending otherwise would leave it talking to a socket that no longer speaks its
	language. Reloading the page is all it takes.
*/
func (l *lanSwitch) SetSecure(on bool) error {
	l.mu.Lock()
	want := l.tlsCfg != nil
	if on == want {
		l.mu.Unlock()
		return nil
	}
	if on && l.baseTLS == nil {
		l.mu.Unlock()
		return fmt.Errorf("this station has no certificate — restart without -tls=false")
	}
	wasOn := l.srv != nil
	if on {
		l.tlsCfg = l.baseTLS
	} else {
		l.tlsCfg = nil
	}
	l.mu.Unlock()

	if !wasOn {
		return nil // nothing is listening; the next Enable picks up the new setting
	}
	if err := l.Disable(); err != nil {
		return err
	}
	return l.Enable()
}

func (l *lanSwitch) URLs() []string {
	if !l.Enabled() {
		return nil
	}
	return lanURLs(true, l.port, l.tlsCfg != nil)
}
