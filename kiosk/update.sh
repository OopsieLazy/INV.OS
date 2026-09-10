#!/usr/bin/env bash
# INV.OS updater — swap the binary, restart the service.
#
#   ./update.sh ../dist/invos-1.4.0-linux-arm64
#   ./update.sh                # newest linux build sitting in ../dist
#
# There is no service-worker cache to bump any more and no index.html to copy: the binary
# IS the app, and the browser is told not to cache the interface. Replacing the file and
# restarting is the whole update.
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
TARGET="$PREFIX/bin/invos"
here="$(cd "$(dirname "$0")" && pwd)"

NEW="${1:-}"
if [[ -z "$NEW" ]]; then
  NEW="$(ls -t "$here"/../dist/invos-*-linux-* 2>/dev/null | head -1 || true)"
fi
if [[ -z "$NEW" || ! -f "$NEW" ]]; then
  echo "!! No new binary given and none found in ../dist."
  echo "   Build one on the dev machine:  ./build.sh"
  exit 1
fi
if [[ ! -x "$TARGET" ]]; then
  echo "!! $TARGET is not installed yet — run ./install.sh first."
  exit 1
fi

echo "==> current: $("$TARGET" -version 2>/dev/null || echo unknown)"
echo "==> new    : $("$NEW" -version 2>/dev/null || echo "$NEW")"

# Keep the outgoing binary. A shop that updates and finds something broken needs a way
# back that does not involve a working internet connection.
cp -f "$TARGET" "$TARGET.prev" 2>/dev/null || true

# The database is untouched by an update — but a backup costs a second and this is the
# moment people most want one to exist.
DATA_DIR="${DATA_DIR:-$HOME/.local/share/invos}"
if [[ -f "$DATA_DIR/invos.db" ]]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  cp "$DATA_DIR/invos.db" "$DATA_DIR/invos-$stamp.db" && \
    echo "==> database copied to invos-$stamp.db"
fi

install -m 0755 "$NEW" "$TARGET"
systemctl --user restart invos.service
echo "==> restarted"

PORT="${PORT:-$(grep -oE '\-port [0-9]+' "$HOME/.config/systemd/user/invos.service" 2>/dev/null | awk '{print $2}' | head -1)}"
PORT="${PORT:-8137}"

for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "==> up on http://127.0.0.1:$PORT — running $("$TARGET" -version)"
    echo "    open tabs pick it up on reload; the app also notices and says so."
    exit 0
  fi
  sleep 0.2
done

echo "!! The new build did not come up. Rolling back."
install -m 0755 "$TARGET.prev" "$TARGET"
systemctl --user restart invos.service
echo "   restored $("$TARGET" -version 2>/dev/null || echo "the previous binary")"
exit 1
