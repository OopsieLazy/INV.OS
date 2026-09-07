// Command invos is the INV.OS shop server: one binary that owns the database, serves
// the UI, and answers on the LAN so every device in the shop sees the same inventory.
//
//	invos                 # localhost only, opens a browser
//	invos -lan            # reachable from the shop's tablets and phones
//	invos -db shop.db -addr :9000 -token secret
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"invos/internal/api"
	"invos/internal/store"
	"invos/internal/web"
)

// version is stamped at build time: -ldflags "-X main.version=1.2.3"
var version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "invos: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		dbPath  = flag.String("db", defaultDB(), "path to the SQLite database file")
		port    = flag.Int("port", 8137, "port to listen on")
		lan     = flag.Bool("lan", false, "listen on all interfaces so shop devices can connect")
		token   = flag.String("token", os.Getenv("INVOS_TOKEN"), "require this token on API calls (LAN deployments)")
		open    = flag.Bool("open", true, "open the app on start")
		window  = flag.Bool("window", true, "open as a desktop app window (false = a normal browser tab)")
		verbose = flag.Bool("v", false, "verbose request logging")
		showVer = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()

	if *showVer {
		fmt.Println("invos " + version)
		return nil
	}

	level := slog.LevelInfo
	if *verbose {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})))

	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}
	st, err := store.OpenSQLite(*dbPath)
	if err != nil {
		return err
	}
	defer st.Close()

	srv := api.New(st, web.Handler())
	srv.Token = *token

	// The app's `server` screen shows where this station is reachable, so the info
	// the flags decided is handed to the API layer rather than guessed at there.
	api.Info = api.ServerInfo{
		Version: version, Port: *port, StartedAt: time.Now().UnixMilli(),
	}

	// The station's own listener is always loopback and always up, so toggling shop
	// access can never cut off the person standing at the machine.
	addr := fmt.Sprintf("127.0.0.1:%d", *port)

	// Listen before announcing anything, so a port clash fails loudly instead of
	// printing a URL that was never going to work.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w (is another copy already running?)", addr, err)
	}

	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	// Shop-wide access is a second listener the app can open and close on demand;
	// -lan just decides whether it starts open.
	shop := newLANSwitch(*port, httpSrv.Handler)
	srv.LAN = shop
	if *lan {
		if err := shop.Enable(); err != nil {
			return err
		}
	}

	local := fmt.Sprintf("http://localhost:%d", *port)
	banner(*dbPath, local, shop.Enabled(), *port, *token != "")

	errCh := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	if *open {
		openWindow(local, *window)
	}

	// Ctrl+C closes the listener and lets in-flight requests finish, so a shutdown
	// mid-write never truncates the database.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case <-stop:
		fmt.Println("\nshutting down…")
	}

	shop.Disable()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpSrv.Shutdown(ctx)
}

func banner(db, local string, lan bool, port int, tokened bool) {
	fmt.Println("  INV.OS " + version)
	fmt.Println("  database  " + db)
	fmt.Println("  local     " + local)
	if !lan {
		fmt.Println("  shop      off — turn it on in the app, or start with -lan")
	}
	if lan {
		for _, ip := range lanIPs() {
			fmt.Printf("  shop      http://%s:%d\n", ip, port)
		}
		if tokened {
			fmt.Println("  auth      token required (X-INVOS-Token)")
		} else {
			fmt.Println("  auth      none — anyone on this network can edit inventory")
		}
	}
	fmt.Println("  ctrl+c to stop")
}

// lanURLs renders the addresses a phone on the same network can open, or nothing when
// the station is bound to localhost only.
func lanURLs(lan bool, port int) []string {
	if !lan {
		return nil
	}
	var out []string
	for _, ip := range lanIPs() {
		out = append(out, fmt.Sprintf("http://%s:%d", ip, port))
	}
	return out
}

// lanIPs lists this machine's addresses on the local network, so the banner can print
// URLs a person can actually type into a tablet.
func lanIPs() []string {
	var out []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return out
	}
	// Prefer real private-network addresses. A machine typically also has link-local
	// (169.254.x.x, from an adapter with no DHCP) and virtual-adapter addresses, and
	// handing one of those to a tablet gives an address that will never answer.
	var private4, other4 []string
	for _, a := range addrs {
		ipNet, ok := a.(*net.IPNet)
		if !ok || ipNet.IP.IsLoopback() || ipNet.IP.IsLinkLocalUnicast() {
			continue
		}
		ip4 := ipNet.IP.To4()
		if ip4 == nil {
			continue
		}
		if ip4.IsPrivate() {
			private4 = append(private4, ip4.String())
		} else {
			other4 = append(other4, ip4.String())
		}
	}
	out = append(out, private4...)
	out = append(out, other4...)
	return out
}

// defaultDB puts the database in the OS's per-user data directory rather than next to
// the exe, so the app works when it lives in Program Files or on a read-only share.
func defaultDB() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "invos.db"
	}
	return filepath.Join(dir, "INV.OS", "invos.db")
}

// openBrowser launches the default browser. Failure is not fatal — the URL is on
// screen and the user can open it by hand.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		slog.Debug("could not open browser", "err", err)
		return
	}
	go func() {
		// reap the child so it does not linger as a zombie on unix
		_ = cmd.Wait()
	}()
}
