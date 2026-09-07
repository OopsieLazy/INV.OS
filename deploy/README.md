# INV.OS — deploy folder

Four files. Put them anywhere that serves over **https** and the app becomes
installable *and* the camera scanner works.

## GitHub Pages (free, ~2 minutes)
1. New repository → upload `index.html`, `sw.js`, `manifest.webmanifest`,
   `icon-192.png`, `icon-512.png` (this README is optional).
2. Settings → Pages → Source: `main` branch, `/ (root)` → Save.
3. Open the `https://<user>.github.io/<repo>/` URL it gives you.
4. Chrome/Edge: an **install** pill appears in the app's title bar (or use the
   browser menu → Install app). iOS Safari: Share → Add to Home Screen.

After the first load it works fully offline — the service worker caches everything.

## Shop PC / Raspberry Pi kiosk
Serve the folder locally instead (localhost also counts as secure):

    cd deploy && python3 -m http.server 8000

Then open `http://localhost:8000`. For a true kiosk with instant label printing:

    chromium-browser --kiosk --kiosk-printing http://localhost:8000

## Secrets / git safety
These files contain **no keys and no inventory data** — your data lives in the
browser's localStorage on each machine. Safe to commit publicly.
The one thing to keep out of a public repo is a `backup` JSON export, if your
part list or notes are private. Add to `.gitignore`:

    invos-*.json
    invos-backup.json

## Updating
Replace `index.html`, then bump `CACHE = "invos-v1"` to `v2` in `sw.js` so
browsers fetch the new version instead of serving the cached one.

## Spreadsheet import (xlsx / xls / ods)
`xlsx.full.min.js` (SheetJS) ships in this folder and is loaded on demand only when you
import a binary spreadsheet — so the base app stays lean. CSV/TSV and copy-paste import
work with no dependency at all. If you serve a flat folder, keep xlsx.full.min.js next to
index.html. The service worker caches it, so import works offline after first load.
