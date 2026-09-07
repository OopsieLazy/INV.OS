#!/usr/bin/env bash
# INV.OS updater — pull a new build and restart the kiosk server.
# Usage:
#   ./update.sh                 # git pull in the app dir, then restart
#   ./update.sh /path/new.html  # drop-in a new index.html, then restart
set -euo pipefail
APP_DIR="${INVOS_DIR:-$HOME/invos}"
PORT="${PORT:-8137}"

if [[ "${1:-}" == *.html ]]; then
  echo "==> installing $1 -> $APP_DIR/index.html"
  cp "$1" "$APP_DIR/index.html"
elif [[ -d "$APP_DIR/.git" ]]; then
  echo "==> git pull in $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  echo "!! $APP_DIR is not a git repo and no .html given."
  echo "   Either: git clone your repo to $APP_DIR,"
  echo "   or run: ./update.sh /path/to/new/index.html"
  exit 1
fi

# bump the service-worker cache so browsers fetch the new build
SW="$APP_DIR/sw.js"
if [[ -f "$SW" ]]; then
  cur=$(grep -oE 'invos-v[0-9]+' "$SW" | head -1 || echo "invos-v1")
  num=${cur##*-v}; new="invos-v$((num+1))"
  sed -i "s/$cur/$new/g" "$SW"
  echo "==> service-worker cache: $cur -> $new"
fi

systemctl --user restart invos.service 2>/dev/null && echo "==> server restarted" || \
  echo "   (server service not found — start it or just reload the browser)"
echo "==> done. Reload the kiosk (Ctrl+R) or it'll pick up the new cache next launch."
