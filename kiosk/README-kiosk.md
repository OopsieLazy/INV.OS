# INV.OS — Arch Linux kiosk setup

Runs the inventory station fullscreen, offline, auto-starting on boot. Because it
serves from `localhost`, the camera scanner and PWA install both work, and
`--kiosk-printing` gives you one-tap silent label printing.

## 1. Install

From the folder that contains both `deploy/` and `kiosk/`:

```bash
cp deploy/* kiosk/            # bring the app files next to the installer
cd kiosk
./install.sh                  # installs to ~/invos, port 8137
# or choose a location:  ./install.sh /opt/invos
```

This installs `chromium` + `python` if missing, starts a tiny local web server as a
**user systemd service** (auto-restarts, survives logout with lingering — see below),
and drops a launcher at `~/.local/bin/invos-kiosk`.

Test it immediately:

```bash
~/.local/bin/invos-kiosk
```

Exit kiosk Chromium with `Ctrl+W` or `Alt+F4` (or `Ctrl+Alt+F2` to another TTY).

## 2. Autostart on boot — pick your compositor

### Option A — Hyprland / Sway / other wlroots (Wayland)
Add to your compositor config:

```
# Hyprland  (~/.config/hypr/hyprland.conf)
exec-once = ~/.local/bin/invos-kiosk

# Sway  (~/.config/sway/config)
exec ~/.local/bin/invos-kiosk
```

### Option B — X11 window manager / .xinitrc
If you `startx` into a bare WM, append to `~/.xinitrc` (before `exec <wm>` if the WM
should keep running, or replace it for a pure kiosk):

```bash
~/.local/bin/invos-kiosk &
```

### Option C — a desktop environment with autostart (GNOME/KDE/XFCE)
Drop a desktop entry:

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/invos.desktop <<'DESK'
[Desktop Entry]
Type=Application
Name=INV.OS Kiosk
Exec=/home/USER/.local/bin/invos-kiosk
X-GNOME-Autostart-enabled=true
DESK
sed -i "s/USER/$USER/" ~/.config/autostart/invos.desktop
```

### Option D — full headless auto-login kiosk (dedicated shop box)
1. Auto-login on tty1 (systemd drop-in):
   ```bash
   sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
   sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf <<'DROP'
   [Service]
   ExecStart=
   ExecStart=-/usr/bin/agetty --autologin YOURUSER --noclear %I $TERM
   DROP
   ```
2. Auto-`startx` from your login shell (`~/.bash_profile`):
   ```bash
   [ "$(tty)" = "/dev/tty1" ] && ! pgrep -x Xorg >/dev/null && exec startx
   ```
3. Put the launcher in `~/.xinitrc` (Option B). Install a minimal WM if you want
   window management: `sudo pacman -S --needed openbox` then `exec openbox-session`
   after the launcher line.

## 3. Keep the server alive without an active login (kiosk boxes)

```bash
sudo loginctl enable-linger "$USER"   # user services run at boot, no login needed
```

## 4. Backups on a real filesystem

Inside the app, run `backup` once and pick a file (e.g. `~/invos-data/backup.json`).
It rewrites itself as you work. For an extra nightly copy:

```bash
mkdir -p ~/invos-backups
(crontab -l 2>/dev/null; echo "0 2 * * * cp ~/invos-data/backup.json ~/invos-backups/invos-\$(date +\%F).json") | crontab -
```

## 5. Updating the app

Replace `~/invos/index.html` with a new build, bump `CACHE="invos-v1"` → `v2` in
`~/invos/sw.js` so the service worker refreshes, then:

```bash
systemctl --user restart invos.service
```

## Notes
- Chromium (not Firefox) is required for the `scan` command's BarcodeDetector API.
- The app holds **no secrets**; data lives in the browser profile at
  `~/.config/invos-chromium`. Back it up with the app's `backup`, not by copying files.
- Printer: install its driver/CUPS first (`sudo pacman -S cups && sudo systemctl enable --now cups`).
  With `--kiosk-printing`, the app's Print buttons skip the dialog entirely.

## Updating the app (git workflow — recommended for a permanent station)

The cleanest "forever" setup keeps the app in a git repo so updates are one command.

**One-time:** put the app under git and host it (e.g. a private GitHub repo — the
files contain no secrets or data; see § secrets). Then on the shop box:
```bash
rm -rf ~/invos && git clone YOUR_REPO_URL ~/invos
```

**Each update Claude gives you a new build:**
1. Commit the new `index.html` (+ any changed files) to your repo and push.
2. On the shop box:  `cd ~/invos-src/kiosk && ./update.sh`
   — it runs `git pull`, bumps the service-worker cache version, and restarts the
   local server. Reload the kiosk with Ctrl+R (or it refreshes next launch).

**No git?** Drop-in a single file instead:
```bash
./update.sh ~/Downloads/index.html
```
Same effect: copies it in, bumps the SW cache, restarts.

> Note: Claude can't push to your box or repo directly (no network path from the
> chat to your shop). The loop is always: Claude builds → you commit/download →
> the box pulls. `update.sh` makes the box side one command.
