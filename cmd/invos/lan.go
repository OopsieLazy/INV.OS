package main

import (
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

// lanSwitch opens and closes shop-wide access while the app is running.
//
// The loopback listener is always up, so the station itself never loses the app. This
// adds a SECOND listener on all interfaces, which is what other devices connect to.
// Two listeners rather than rebinding one means flipping the switch never interrupts
// the person standing at the machine.
//
// The shop listener gets its OWN http.Server, and that is not an implementation
// detail: closing a listener only stops NEW connections, and a tablet holding a
// keep-alive connection would carry on being served after the switch was thrown. A
// separate server can be Closed, which drops the listener and every connection on it.
// "Off" has to actually mean off.
type lanSwitch struct {
	mu      sync.Mutex
	port    int
	handler http.Handler
	srv     *http.Server // nil when shop access is off

	// tlsCfg, when set, encrypts shop access. Loopback is left on plain HTTP: it never
	// touches a wire, and a certificate warning on the station's own screen every
	// morning would teach the shop to click through certificate warnings.
	tlsCfg *tls.Config
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
	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", l.port))
	if err != nil {
		return fmt.Errorf("could not open port %d to the network: %w", l.port, err)
	}
	// A closed http.Server cannot be reused, so each time shop access is opened it
	// gets a fresh one.
	srv := &http.Server{
		Handler:           l.handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	l.srv = srv
	if l.tlsCfg != nil {
		ln = tls.NewListener(ln, l.tlsCfg)
	}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Debug("shop listener stopped", "err", err)
		}
	}()
	slog.Info("shop access on", "port", l.port)
	return nil
}

// Disable closes the shop listener AND every connection on it, so a device that was
// already talking to the station is cut off rather than quietly kept alive.
func (l *lanSwitch) Disable() error {
	l.mu.Lock()
	srv := l.srv
	l.srv = nil
	l.mu.Unlock()

	if srv == nil {
		return nil
	}
	err := srv.Close()
	slog.Info("shop access off")
	return err
}

// URLs lists what a phone or tablet on the same network should open. Empty when shop
// access is off, because there is nothing to type in.
func (l *lanSwitch) URLs() []string {
	if !l.Enabled() {
		return nil
	}
	return lanURLs(true, l.port, l.tlsCfg != nil)
}
