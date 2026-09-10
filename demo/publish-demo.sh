#!/usr/bin/env bash
# Publish the demo to GitHub Pages.
#
# The demo lives on its own orphan branch, `gh-pages`, holding nothing but the built page.
# Two reasons for a separate branch rather than a folder on main:
#
#   - main stays source. A 350KB generated HTML file committed on every demo change would
#     bury the actual diffs.
#   - Pages serves the branch root, so the URL is the repo root rather than /docs/demo/.
#
# The page itself is built from internal/web/ui/index.html — the same file the binary
# serves — so the demo cannot drift from the product it is advertising.
#
#   ./demo/publish-demo.sh            # build, commit, push
#   ./demo/publish-demo.sh --local    # build and commit, don't push
set -euo pipefail
cd "$(dirname "$0")/.."

PUSH=1
[[ "${1:-}" == "--local" ]] && PUSH=0

echo "==> building the demo from the product UI"
./demo/build-demo.sh >/dev/null

WORK=".gh-pages-work"
rm -rf "$WORK"

# A worktree, so this never touches your checkout or your current branch.
if git show-ref --quiet refs/heads/gh-pages; then
  git worktree add -q "$WORK" gh-pages
else
  echo "==> creating the gh-pages branch"
  git worktree add -q --detach "$WORK"
  git -C "$WORK" checkout -q --orphan gh-pages
  git -C "$WORK" rm -rq --cached . 2>/dev/null || true
  find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
fi

cp dist/demo/index.html "$WORK/index.html"
# Without this, Pages runs the page through Jekyll, which silently drops files and folders
# beginning with an underscore.
: > "$WORK/.nojekyll"

cat > "$WORK/README.md" <<'EOF'
# INV.OS — live demo

This branch is generated. It holds one file: the demo page, built from
`internal/web/ui/index.html` on `main`.

Do not edit it here — edit the source and run `./demo/publish-demo.sh`.

The demo runs entirely in your browser. Nothing is sent anywhere, and your changes stay in
your own browser storage.
EOF

git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "==> demo is already up to date"
else
  git -C "$WORK" commit -q -m "demo: rebuild from $(git rev-parse --short HEAD)"
  echo "==> committed"
fi

if [[ "$PUSH" == 1 ]]; then
  git -C "$WORK" push -q -u origin gh-pages
  echo "==> pushed"
  repo="$(git config --get remote.origin.url | sed -e 's#.*github.com[:/]##' -e 's#\.git$##')"
  user="${repo%%/*}"; name="${repo##*/}"
  echo
  echo "    https://$(echo "$user" | tr 'A-Z' 'a-z').github.io/$name/"
  echo
  echo "    If that 404s, switch it on once:"
  echo "      Settings -> Pages -> Source: Deploy from a branch -> gh-pages / (root)"
  echo "    It takes a minute or two the first time."
fi

git worktree remove --force "$WORK"
