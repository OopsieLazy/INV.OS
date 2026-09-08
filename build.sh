#!/usr/bin/env bash
# Release builds for every box INV.OS is meant to run on.
#
# The database driver is modernc.org/sqlite — pure Go, no cgo — which is the whole reason
# a Windows machine can produce a working Raspberry Pi binary with no cross-toolchain and
# no container. CGO_ENABLED=0 is set explicitly so that stays true even on a machine where
# cgo is available and would otherwise be the default.
#
#   ./build.sh             # version from the current git tag
#   ./build.sh 1.4.0       # or say it outright
set -euo pipefail

cd "$(dirname "$0")"
export PATH="$PATH:/c/Program Files/Go/bin"

# `git describe` gives 25.3 on a tagged commit and 25.3-4-gabc1234 four commits later, so
# a binary always says how far past a release it is rather than claiming to BE one.
VERSION="${1:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"
OUT=dist
rm -rf "$OUT"; mkdir -p "$OUT"

echo "==> INV.OS $VERSION"

build() {
  local os=$1 arch=$2 ext=${3:-}
  local name="invos-$VERSION-$os-$arch$ext"
  echo "    $os/$arch"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" \
    -o "$OUT/$name" ./cmd/invos
}

build windows amd64 .exe
build linux   amd64
build linux   arm64          # Raspberry Pi 4/5, and most cheap shop boxes
build darwin  arm64          # Apple silicon, for the bench laptop

# A checksum file is the minimum a person needs to tell a download apart from something
# that was interfered with on the way.
( cd "$OUT" && sha256sum ./* > SHA256SUMS )

echo
ls -lh "$OUT" | sed 's/^/    /'
echo
echo "==> $OUT/  ($VERSION)"
echo "    Windows binaries are UNSIGNED — SmartScreen will warn on first run."
echo "    Signing needs a code-signing certificate; see ROADMAP-v2.md P10."
