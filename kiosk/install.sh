#!/usr/bin/env bash
# INV.OS kiosk installer for Arch Linux.
# Serves the app locally and launches Chromium fullscreen on login.
set -euo pipefail

APP_DIR="${1:-$HOME/invos}"        # where the app files live
PORT="${PORT:-8137}"

echo "==> INV.OS kiosk install"
echo "    app dir : $APP_DIR"
echo "    port    : $PORT"

# --- deps ---
need=()
command -v chromium >/dev/null 2>&1 || need+=(chromium)
command -v python3  >/dev/null 2>&1 || need+=(python)
if ((${#need[@]})); then
  echo "==> installing: ${need[*]}"
  sudo pacman -S --needed --noconfirm "${need[@]}"
fi

# --- app files ---
mkdir -p "$APP_DIR"
cp -v index.html manifest.webmanifest sw.js icon-192.png icon-512.png "$APP_DIR"/ 2>/dev/null || {
  echo "!! run this from inside the kiosk/ folder's sibling 'deploy' — copy the deploy files first"; exit 1; }

# --- local static server as a user service (localhost = secure origin: camera + PWA work) ---
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/invos.service" <<UNIT
[Unit]
Description=INV.OS local server
After=network.target

[Service]
ExecStart=/usr/bin/python3 -m http.server $PORT --bind 127.0.0.1 --directory $APP_DIR
Restart=always

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now invos.service
echo "==> server running at http://localhost:$PORT"

# --- kiosk launcher ---
install -Dm755 /dev/stdin "$HOME/.local/bin/invos-kiosk" <<LAUNCH
#!/usr/bin/env bash
# wait for the server, then open Chromium in kiosk mode
for i in \$(seq 1 30); do
  curl -sf "http://localhost:$PORT" >/dev/null && break || sleep 0.5
done
exec chromium \\
  --kiosk \\
  --kiosk-printing \\
  --app="http://localhost:$PORT" \\
  --start-fullscreen \\
  --no-first-run \\
  --disable-translate \\
  --disable-features=TranslateUI \\
  --overscroll-history-navigation=0 \\
  --disable-pinch \\
  --user-data-dir="$HOME/.config/invos-chromium"
LAUNCH

echo "==> launcher installed: ~/.local/bin/invos-kiosk"
echo
echo "Next: pick ONE autostart method:"
echo "  • Wayland/X later — see kiosk/README-kiosk.md (§ autostart)"
echo "  • test right now:  ~/.local/bin/invos-kiosk"
