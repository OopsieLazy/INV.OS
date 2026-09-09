# Changelog

- [v0.1.0 — what this release is](#v010)
- [The big change: HTML app → one binary](#the-big-change)
- [What got faster](#what-got-faster)
- [The graph](#the-graph)
- [Features](#features)
- [Security](#security)
- [Packaging and the demo](#packaging-and-the-demo)
- [Bugs worth knowing about](#bugs-worth-knowing-about)
- [Tags](#tags)
- [Where to read more](#where-to-read-more)

---

## v0.1.0

First public release. It works and it is in use. It is not 1.0 and the version says so.

One binary. It contains the whole interface, owns a real SQLite database, and serves the
shop's tablets over the LAN. No install, no runtime, no account, no internet.

Licence: AGPL-3.0.

---

## The big change

Before this, INV.OS was one HTML file. It held the entire inventory in browser memory as a
single JSON blob and rewrote all of it on every save. That is fine at 200 items and falls
over well before 10,000.

Now it is a Go binary with a real database:

| | before | now |
|---|---|---|
| storage | one JSON blob in the browser | SQLite, one row per item |
| a write | re-serialise everything | one statement |
| memory | grows with the inventory | flat |
| reads | load it all, filter in JS | paginated queries |
| shop access | a folder served by python | the binary itself, encrypted |

The rule that came out of it: **no code path loads all items into memory.** Five commands
break that on purpose — `doctor`, `tidy`, `remap`, `export` and the report — because they
are meaningless on one page of results. They page through it and say so.

The old HTML app is still tagged (`html-demo-v20.2`) and the port is at full feature
parity with it. Nothing is gated.

---

## What got faster

Measured with `cmd/invos-stress`, not estimated. At 100,000 items:

- search: **2ms**
- home screen: **0ms** (was 68ms — per-shelf totals are kept by SQL triggers now)
- memory: **0.4 MB heap at 10k and at 100k**, process 16.5 MB
- graph physics: **1702ms → 17ms**

Search is FTS5 with the trigram tokenizer, so any fragment matches anywhere — type `sist`
and get resistors. Fragments under three characters fall back to LIKE.

The thing that actually cost time was not fetching rows. Fetching 8 matching rows was
already 0ms. It was the exact `COUNT(*)` and the global `ORDER BY`, which both have to
visit every match. Live search stops counting at 200 and says so; explicit actions get
exact answers.

---

## The graph

Runs to 20,000 nodes at 60fps.

- spatial hash grid for repulsion instead of every-pair
- above 1,500 nodes it draws pixels directly instead of shapes
- projects as clusters, with bridges where two projects share a part
- orbit mode: parts orbit their project, off by default because it costs a frame every frame

Most of the work here was chasing things that felt wrong rather than measured wrong: a
stutter that turned out to be garbage collection (the renderer was allocating ~6,000
objects a frame), orbits that teleported on the first frame, a drift that ran at different
speeds on different monitors because it advanced per frame instead of per second.

**Known and not fixed:** the galaxy view does not look like its own pitch yet. Projects get
flung to the edge and shared parts collapse into one knot in the middle, so it reads as a
spider rather than clusters. `graph inv` is the better picture today and it is what the
README uses. Roadmap A1 has the two layout fixes.

---

## Features

Everything from the HTML app, plus:

- **projects and BOMs** — `build` consumes a whole bill of materials in one transaction.
  Either it all comes off the shelf or none of it does, and one `undo` puts it all back.
- **who did what** — `who <name>` per device, stamped on every change, `recent by <name>`.
  It is attribution, not a login: anyone can type any name. It answers "who took the last
  one", which is the question shops actually ask.
- **legacy import** — `import legacy <file>` moves a shop off the old HTML build. Reads all
  four shapes it wrote. Keeps your original C-IDs, because your labels are already on the
  drawers. Reports what it will do before writing anything.
- **guided tour** — `tutorial`, six steps. It watches what you type rather than driving;
  wander off and it waits.
- **shareable graph export** — `graph png` now captions the image with the shop name, the
  view and the count.
- **mobile** — below 760px the graph stacks above the terminal, touch targets get bigger,
  and the input is 16px so iOS stops zooming the page.
- **shop defaults** — save a set of settings that new devices start from. Settings are
  per-device otherwise; a bench tablet and the office PC want different things.

C-IDs are never reused, even after a delete or an undo. A label on a drawer points at one
thing forever.

---

## Security

No accounts, and that is deliberate. The goal is that the app is not a way into your
network, not that it can tell two people apart.

- **shop access is encrypted** — self-signed, so each device warns once. Localhost stays
  plain http; it never touches a wire.
- **`lan http` / `lan https`** — switch it at runtime. The certificate is self-signed, and
  a label printer or an ESP32 cannot be taught to accept one. Better to let those talk
  plainly than to have the shop keep a second copy of the data somewhere else.
- **the key gates the network, not the console** — a tablet needs it, the machine it runs
  on does not. Whoever is sitting at the station can open the database file anyway.
- **it refuses the internet** — anything from outside your local network is turned away
  before it reaches a handler. The realistic way this goes wrong is UPnP or an old port
  forward, not somebody picking a lock.
- **cross-site writes refused**, strict content-security-policy, rate limiting, no
  telemetry ever.

Injection was audited by attacking it, not by reading it: six payloads in every field a
person can type into, rendered through every screen including printed labels. Nothing
executes. The sort column is an allowlist and every value is parameterised.

What this does **not** protect you from is in MANUAL.md §6. Short version: the certificate
encrypts but cannot prove identity, the key is a door lock not a user system, and the
database is not encrypted at rest.

---

## Packaging and the demo

- `./build.sh` — windows/amd64, linux/amd64, linux/arm64 (Pi), darwin/arm64, with
  checksums. Pure-Go SQLite means a Windows machine builds a working Pi binary with no
  toolchain and no container.
- `./make-release.sh` — assembles the demo, the binaries and the paperwork into `release/`.
- the kiosk scripts were rewritten. They used to copy `index.html` around and run
  `python3 -m http.server`. Now: one binary, one systemd unit, and `update.sh` rolls back
  by itself if the new build will not start.
- **the demo is generated from the product**, not forked from it. Every data call in the UI
  goes through one function, so the demo answers that function in the browser instead of
  over a socket. There is no second copy of the interface to keep in step.

Windows binaries are unsigned. SmartScreen will warn on first run. Signing needs a
purchased certificate.

---

## Bugs worth knowing about

Ones that were live and are not any more:

- the service worker was serving a stale UI — a bin could read 40 when the drawer held 4
- `-token` bricked the app: the page loaded, then every request 401'd
- turning shop access on broke the station's own URL (`localhost` resolves to `::1`, and
  the shop listener was claiming it)
- `import legacy {path}` would read any file on the machine, for any caller
- BOM parts never showed low stock in the project views
- department and shelf renames never reached the database
- an import could not be undone
- the graph sat on the wrong zoom for eight seconds and then jumped 2.3× wider
- launch zoom did nothing on any graph bigger than the window

---

## Tags

| tag | what it is |
|---|---|
| `html-demo-v20.2` | the original single-file HTML app, frozen. History only. |
| `v25.0-polished` | a mid-work snapshot, kept as a recall point. Not a release. |
| `v0.1.0` | this release. |

---

## Where to read more

- **[README.md](README.md)** — what it is, and what it will not do
- **[MANUAL.md](MANUAL.md)** — every command, setup, security posture
- **[NOTES.md](NOTES.md)** — the real changelog. One section per version, with the
  measurements and the reasoning, including the things I got wrong.
- **[ROADMAP-v2.md](ROADMAP-v2.md)** — what is next and why, starting with a status block
- **[RELEASE.md](RELEASE.md)** — the checklist for getting this out
