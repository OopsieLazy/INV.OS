#!/usr/bin/env bash
# Assemble everything that gets uploaded, into one folder.
#
# Two things ship, and they are not the same thing:
#   release/demo/     the public demo — static HTML, goes on GitHub Pages
#   release/binaries/ the product — one file per platform, goes on Releases
#
# Both are built from the SAME internal/web/ui/index.html, so the demo cannot drift from
# the thing it is advertising.
#
#   INVOS_SOURCE_URL=https://github.com/you/invos ./make-release.sh
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$PATH:/c/Program Files/Go/bin"

OUT=release
VERSION="${1:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"

# Fail here rather than three steps later: the binaries carry this address, and the
# licence requires it to be real.
SOURCE_URL="${INVOS_SOURCE_URL:-https://github.com/REPLACE-ME/invos}"
if [[ "$SOURCE_URL" == *REPLACE-ME* ]]; then
  echo "!! Set INVOS_SOURCE_URL to the real repo before cutting a release."
  echo "   AGPL-3.0 requires the binary to tell network users where its source is."
  echo "     INVOS_SOURCE_URL=https://github.com/<you>/invos ./make-release.sh"
  exit 1
fi

echo "==> INV.OS release $VERSION"
rm -rf "$OUT"
mkdir -p "$OUT/demo" "$OUT/binaries"

# ── the demo ────────────────────────────────────────────────────────────────
echo "--> demo"
./demo/build-demo.sh >/dev/null
cp dist/demo/index.html "$OUT/demo/index.html"
# GitHub Pages runs Jekyll unless told not to, and Jekyll silently drops files and
# folders beginning with an underscore.
: > "$OUT/demo/.nojekyll"

# ── the binaries ────────────────────────────────────────────────────────────
echo "--> binaries"
INVOS_SOURCE_URL="$SOURCE_URL" ./build.sh "$VERSION" >/dev/null
cp dist/invos-* "$OUT/binaries/" 2>/dev/null || true
cp dist/SHA256SUMS "$OUT/binaries/" 2>/dev/null || true

# ── the paperwork ───────────────────────────────────────────────────────────
cp LICENSE README.md MANUAL.md "$OUT/"

cat > "$OUT/DEPLOY.md" <<DEPLOY
# Publishing this

Built from $VERSION. Source: $SOURCE_URL

## The demo -> GitHub Pages

\`demo/index.html\` is the whole demo. It has no server, no build step and no
dependencies: it runs entirely in the visitor's browser and stores their changes in that
browser.

1. Push \`demo/\` to the repo (either on \`main\` under \`/docs\`, or to a \`gh-pages\` branch).
2. Settings -> Pages -> pick that branch and folder.
3. The URL becomes \`https://<you>.github.io/<repo>/\`.

Keep \`.nojekyll\` — without it Pages runs Jekyll, which drops files beginning with an
underscore and will eventually eat something you need.

**Check on a phone before announcing it.** Not a resized desktop window — an actual phone.

## The binaries -> GitHub Releases

\`binaries/\` holds one file per platform plus \`SHA256SUMS\`. Upload all of them to a
release tagged $VERSION.

Say in the release notes that **Windows binaries are unsigned** and SmartScreen will warn
on first run. Being the one who says it first is the difference between honest and
suspicious.

Test each binary on a machine that is not the one that built it. The first comment on any
release post is somebody saying it does not start.

## Repo settings worth doing once

**Topics** (Settings -> General, or the gear beside About):

\`\`\`
inventory  inventory-management  selfhosted  self-hosted  sqlite  golang  go
workshop  makerspace  homelab  warehouse  stock-management  single-binary  agpl
\`\`\`

**About** — one line, no adjectives:

> Keyboard-first inventory for a workshop. One binary, SQLite, no account, no cloud.

Then add the demo URL to the About panel's website field.
DEPLOY

echo
find "$OUT" -type f | sed 's/^/    /' | sort
echo
du -sh "$OUT" | sed 's/^/    total /'
echo
echo "==> $OUT/ is the upload. DEPLOY.md says where each part goes."
