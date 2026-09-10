#!/usr/bin/env bash
# INV.OS shop-box installer — Linux (Arch, Debian/Ubuntu, Raspberry Pi OS).
#
# Installs ONE binary and a systemd service. There is no web root to copy, no python, no
# service worker, no cache to bust: the exe embeds the whole interface and owns the
# database. The previous version of this script copied index.html into a folder and ran
# `python3 -m http.server` in front of it — that was the old static-folder model, and the
# binary replaces both halves of it.
#
#   ./install.sh                          # find the binary next to this script
#   ./install.sh ./invos-1.4.0-linux-arm64
#   PORT=9000 LAN=0 ./install.sh          # a station nobody else needs to reach
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
DATA_DIR="${DATA_DIR:-$HOME/.local/share/invos}"
PORT="${PORT:-8137}"
LAN="${LAN:-1}"                      # 1 = let the shop's tablets in
KIOSK="${KIOSK:-1}"                  # 1 = also install the fullscreen browser launcher

here="$(cd "$(dirname "$0")" && pwd)"

# --- find the binary ---------------------------------------------------------
BIN_SRC="${1:-}"
if [[ -z "$BIN_SRC" ]]; then
  # newest matching build sitting next to the script or in ../dist
  BIN_SRC="$(ls -t "$here"/invos "$here"/invos-*-linux-* "$here"/../dist/invos-*-linux-* 2>/dev/null | head -1 || true)"
fi
if [[ -z "$BIN_SRC" || ! -f "$BIN_SRC" ]]; then
  echo "!! No INV.OS binary found."
  echo "   Build one:  ./build.sh    then:  ./kiosk/install.sh ../dist/invos-<version>-linux-<arch>"
  exit 1
fi

# Refuse a binary for the wrong machine now, rather than after the service fails to start.
arch="$(uname -m)"
case "$arch" in
  x86_64)          want=amd64 ;;
  aarch64|arm64)   want=arm64 ;;
  *) echo "!! Unsupported architecture: $arch"; exit 1 ;;
esac
if [[ "$BIN_SRC" == *linux-* && "$BIN_SRC" != *"$want"* ]]; then
  echo "!! $BIN_SRC does not look like a $want build for this $arch machine."
  exit 1
fi

echo "==> INV.OS install"
echo "    binary  : $BIN_SRC"
echo "    into    : $PREFIX/bin/invos"
echo "    database: $DATA_DIR/invos.db"
echo "    port    : $PORT   (shop access: $([[ $LAN == 1 ]] && echo on || echo off))"

mkdir -p "$PREFIX/bin" "$DATA_DIR"
install -m 0755 "$BIN_SRC" "$PREFIX/bin/invos"
"$PREFIX/bin/invos" -version

# --- the service -------------------------------------------------------------
# A USER service, not a system one: the database lives in the user's own directory and
# nothing here needs root. Lingering (below) is what lets it run without a login.
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
lanflag=""; [[ "$LAN" == 1 ]] && lanflag=" -lan"

cat > "$UNIT_DIR/invos.service" <<UNIT
[Unit]
Description=INV.OS inventory station
After=network-online.target

[Service]
# -open=false because a server has no business opening a browser; the kiosk launcher
# below does that separately, and a headless box must not try at all.
ExecStart=$PREFIX/bin/invos -db $DATA_DIR/invos.db -port $PORT$lanflag -open=false
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable invos.service
# restart, not `enable --now`. --now only STARTS a service that is not already running,
# so installing over a station that is up left the OLD process serving — the new unit
# written, daemon-reload done, and the previous binary still answering. That is not a
# theoretical failure: it is how a station ended up running a python http.server long
# after it had been replaced, with the health check below reporting 404 and nothing
# saying why. An install has to end with the thing you just installed running.
systemctl --user restart invos.service

# Without lingering the service dies at logout, which is exactly what a shop box does
# when the screen sleeps and nobody is logged in.
if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" >/dev/null 2>&1 || \
    echo "   (could not enable lingering; run: sudo loginctl enable-linger $USER)"
fi

# --- optional: the fullscreen browser ---------------------------------------
if [[ "$KIOSK" == 1 ]]; then
  browser="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
  if [[ -z "$browser" ]]; then
    echo "   (no chromium found — skipping the kiosk launcher; the service is running either way)"
  else
    cat > "$PREFIX/bin/invos-kiosk" <<KIOSKEOF
#!/usr/bin/env bash
# Fullscreen INV.OS. Serving from localhost is what makes the camera scanner and
# one-tap label printing work, so this points at 127.0.0.1 even when LAN is on.
exec "$browser" --kiosk --kiosk-printing --noerrdialogs --disable-infobars \\
  --app=http://127.0.0.1:$PORT
KIOSKEOF
    chmod +x "$PREFIX/bin/invos-kiosk"
    echo "    kiosk   : $PREFIX/bin/invos-kiosk"
  fi
fi

# --- prove it is actually up -------------------------------------------------
echo "==> waiting for the server"
ok=0
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 0.2
done
if [[ "$ok" == 1 ]]; then
  echo "==> up on http://127.0.0.1:$PORT"
  [[ "$LAN" == 1 ]] && echo "    shop devices: run 'server' inside the app for the address and QR"
else
  echo "!! It did not answer. Look at:  systemctl --user status invos.service"
  exit 1
fi

echo
echo "    update later:  ./kiosk/update.sh <new binary>"
echo "    your data   :  $DATA_DIR/invos.db   (one ordinary file — back it up)"
