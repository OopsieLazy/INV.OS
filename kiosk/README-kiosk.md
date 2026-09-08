# INV.OS — shop box setup (Linux / Raspberry Pi)

Runs the inventory station on boot, fullscreen, offline. Works on Arch, Debian/Ubuntu and
Raspberry Pi OS.

This used to be a folder of files served by `python3 -m http.server`. It is not any more:
**one binary** contains the interface and owns the database. There is no web root, no
python, no service worker and no cache to bust.

## 1. Build a binary for the box

On your dev machine:

```bash
./build.sh
```

That produces `dist/invos-<version>-linux-amd64` and `-linux-arm64` (Pi 4/5), among others.
The SQLite driver is pure Go, so a Windows machine cross-compiles a working Pi binary with
no toolchain and no container.

## 2. Install it

Copy `dist/` and `kiosk/` to the box, then:

```bash
./kiosk/install.sh                       # picks the newest matching build
./kiosk/install.sh ../dist/invos-1.4.0-linux-arm64
PORT=9000 LAN=0 ./kiosk/install.sh       # a station nobody else needs to reach
```

It installs `~/.local/bin/invos`, enables a **user** systemd service, turns on lingering so
it survives logout, and — if chromium is present — drops a fullscreen launcher at
`~/.local/bin/invos-kiosk`. It then waits for `/api/health` and fails loudly if the server
did not actually come up.

| variable | default | meaning |
|---|---|---|
| `PORT` | 8137 | port to serve on |
| `LAN` | 1 | let the shop's tablets in (`-lan`) |
| `KIOSK` | 1 | also install the fullscreen browser launcher |
| `PREFIX` | `~/.local` | where the binary goes |
| `DATA_DIR` | `~/.local/share/invos` | where the database lives |

Serving from `localhost` is what makes the camera scanner and one-tap label printing work,
so the kiosk launcher points at `127.0.0.1` even when LAN access is on.

## 3. Update it

```bash
./kiosk/update.sh ../dist/invos-1.5.0-linux-arm64
```

Copies the database first, keeps the outgoing binary as `invos.prev`, restarts, and waits
for health. **If the new build does not come up it puts the old one back automatically** —
a shop box that will not start is not something to debug on a Friday afternoon.

## 4. Running it

```bash
systemctl --user status invos.service     # is it up
systemctl --user restart invos.service    # bounce it
journalctl --user -u invos.service -f     # what is it saying
~/.local/bin/invos-kiosk                  # fullscreen browser
```

Autostart the browser on login by adding `invos-kiosk` to your desktop's autostart, or run
it from `.xinitrc` on a box with no desktop.

## 5. Your data

One file: `~/.local/share/invos/invos.db`. Copy it anywhere. `backup` inside the app writes
a consistent copy while the shop is still using it, which is the safe way to take one.
