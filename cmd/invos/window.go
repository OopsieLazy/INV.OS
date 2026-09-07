package main

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// openWindow launches INV.OS as a desktop application window rather than a browser tab.
//
// It uses the Chromium "app mode" that Edge and Chrome both support: no tabs, no
// address bar, no bookmarks — just the app, with its own taskbar entry and icon. A
// dedicated profile directory keeps it separate from the user's browsing, so window
// size and zoom persist and no extension can see the inventory.
//
// This is deliberately NOT an embedded webview. A webview would mean cgo, which costs
// the single static binary and the trivial cross-compile to a Raspberry Pi — a bad
// trade for a window decoration. Every Windows 10/11 machine already has Edge, and the
// kiosk boxes already run Chromium.
//
// Falls back to the default browser when no Chromium-family browser is found, so the
// app always opens something.
func openWindow(url string, appMode bool) {
	if appMode {
		if exe := findChromium(); exe != "" {
			profile := filepath.Join(appDataDir(), "window")
			cmd := exec.Command(exe,
				"--app="+url,
				"--user-data-dir="+profile,
				"--no-first-run",
				"--no-default-browser-check",
				// the app owns its data; a browser-side cache only creates
				// opportunities for it to show something stale
				"--disable-background-networking",
			)
			if err := cmd.Start(); err == nil {
				go func() { _ = cmd.Wait() }()
				slog.Debug("opened app window", "browser", exe)
				return
			} else {
				slog.Debug("app window failed, falling back to the browser", "err", err)
			}
		}
	}
	openBrowser(url)
}

// findChromium returns the first Edge or Chrome install it can find, or "".
func findChromium() string {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		for _, base := range []string{
			os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LocalAppData"),
		} {
			if base == "" {
				continue
			}
			candidates = append(candidates,
				filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"),
			)
		}
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		}
	default:
		for _, name := range []string{"chromium", "chromium-browser", "google-chrome", "microsoft-edge"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c
		}
	}
	return ""
}

// appDataDir is where this app keeps things that belong to the machine rather than the
// inventory — the window profile, for instance.
func appDataDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "."
	}
	return filepath.Join(dir, "INV.OS")
}
