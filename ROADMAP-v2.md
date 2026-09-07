# INV.OS — Roadmap v2  (restructured by build priority)
Supersedes ROADMAP.md (kept for history). Local-first, offline, keyboard-first
inventory terminal + optional server/DB. This version orders work by dependency,
effort, and impact — "what to tackle first," not just a feature list.

Legend: [x] done · [~] partial · [ ] todo · ★ = recommended next

═══════════════════════════════════════════════════════════════
## DONE (shipped & tested)
═══════════════════════════════════════════════════════════════
[x] Core tracking: add/take/stock/move/edit/del, live search, unified nav, ghost text,
    command menu, focused views, projects/BOM, build, pick list
[x] R1 Photos (Fallout-card layout, HUD frame, node-click shows photo)
[x] R2 Cycle-count / audit (guided walk, discrepancy log, scopes, report)
[x] Brain graph 2D + 3D holographic (inventory / projects / project views), HUD, sweep,
    themes, node-cores toggle, settings screen
[x] QR labels (verified) + camera scan (lookup)
[x] Data integrity: checksum envelope, dual-write+verify, fallback chain, snapshots,
    health, rollback, boot self-check, off-machine reminder
[x] Storage adapters behind one seam: local (default) · optional Go/SQLite server
    (contract byte-exact tested) · physical SQLite .db mirror (external-tool verified)
[x] R10a Spreadsheet import (CSV/TSV/xlsx/xls/ods/paste, fuzzy mapping, wizard) +
    competitor migration (Sortly/Zoho/inFlow/Square headers)
[x] R11 trio: first-run doors, shop-setup wizard, demo separation
[x] Editable departments/sections + `sections` manager screen (add/rename/remove)
[x] PWA install + file auto-backup · Arch/niri kiosk kit + update workflow

═══════════════════════════════════════════════════════════════
## PHASE A — do next (high impact, low/medium effort, few deps)
═══════════════════════════════════════════════════════════════

### A1 — R12 Project Galaxy  [x] DONE v19 · orbit mode v21.3
3D projects-as-galaxy-clusters; shared parts = bridges between clusters; grow over time.
Why first: highest delight-per-effort, reuses the existing 3D engine/themes/HUD, and it's
the feature the user is most excited about. Standalone — no backend, no data-model change.
- [ ] `graph galaxy` view: project = cluster core, its BOM parts orbit as stars
- [ ] shared-part bridges between project clusters (thicker = more shared)
- [ ] time-grow: fade projects in by created date (scrub / autoplay)
- [ ] dept-tinted stars, low-stock pulse, active project brightest
- [ ] click a cluster -> existing single-project view
- [ ] spatial-grid guard if node count gets large

### A2 — R13 Project docs & gallery
Pairs with A1: gives clusters real content + a show-and-tell artifact.
- [ ] per-project writeup (`proj doc <name>`), downloadable .md/.txt
- [ ] attach images to a project (reuse R1 photo storage), gallery on the card
- [ ] used as cluster texture/richness in the galaxy view

### A3 — R7 Reporting / analytics  [~ -> finish]
Leverages the already-rich activity log; near-free value, no deps.
- [ ] usage analytics: most-taken, stale stock (untouched N mo), consumption rate
- [ ] suggested min/reorder raises from real usage
- [ ] valuation report (qty × unit cost) by dept/section/total
- [ ] PDF report export (reuse print pipeline)

═══════════════════════════════════════════════════════════════
## PHASE B — operational depth (medium effort, real-shop value)
═══════════════════════════════════════════════════════════════

### B1 — R3 Check-out / check-in (custody)
The one tracking gap left: who has a tool / where it is right now.
- [ ] `out <id> <who|where>` / `in <id>`; item shows "OUT @lathe-3"
- [ ] "what's out now" view; overdue flag
- [ ] ties into the activity log (with operator, see B2)

### B2 — R4 Operator identity + attributed audit trail
- [ ] `who <name>` sets session operator (lightweight, no auth)
- [ ] stamp every mutation with the operator; `recent by <name>`; export column
- [ ] groundwork for true multi-user (Phase D)

### B3 — R5 Suppliers, reorder points, purchase workflow  [~ -> finish]
Fields exist (supplier/source/link); turn low-stock into ACTION.
- [ ] add: supplier SKU, unit cost, reorder point, reorder qty
- [ ] `reorder` builds a buy list grouped by supplier w/ costs + totals
- [ ] printable/exportable PO per supplier

═══════════════════════════════════════════════════════════════
## PHASE C — scanning & mobility (multiplies earlier work)
═══════════════════════════════════════════════════════════════

### C1 — R6 Scanning as a primary workflow  [~ -> finish]
- [ ] `scan` becomes a MODE feeding actions: scan -> take / stock / count / check-out
- [ ] continuous scan loop; external USB/BT scanner (keyboard-wedge) support
- [ ] scan-to-count + scan-to-checkout (needs B1/R2)

### C2 — R10b Mobility
- [ ] responsive/touch layout (bigger targets, on-screen quick actions)
- [ ] phone quick-count / quick-take screens
- [ ] camera-first add on mobile (pairs R1)
Note: true multi-device usefulness needs Phase D.

═══════════════════════════════════════════════════════════════
## PHASE D — multi-station (when the user runs a server; they said "later")
═══════════════════════════════════════════════════════════════

### D1 — R8 Multi-user / shared data  [~ POC done]
- [x] local-first adapter + Go/SQLite server + physical .db mirror (all verified)
- [ ] compile/run the server live; kiosk connects over LAN/VPN
- [ ] import-MERGE (reconcile external edits, not just replace)
- [ ] per-user access levels (builds on B2)

═══════════════════════════════════════════════════════════════
## PHASE E — creative / discovery (delightful, do when core is settled)
═══════════════════════════════════════════════════════════════

### E1 — R14 Project discovery / inspiration feed
- [ ] offline curated idea seed (ship a JSON of buildable projects) — works no-net
- [ ] optional online pull (are.na channel / maker feed), strictly opt-in
- [ ] "catch the shooting star": drifting suggestion -> capture -> project stub
- [ ] match ideas to current stock (BOM readiness)

═══════════════════════════════════════════════════════════════
## DEFERRED — onboarding polish
═══════════════════════════════════════════════════════════════
- [ ] R11.4 interactive tutorial (`tutorial`): skippable/re-runnable 6-step walkthrough
- [ ] R11.5 contextual first-time hints (one dim tip per screen, never twice)
- [ ] R11.6 getting-started progress checklist (milestones)

═══════════════════════════════════════════════════════════════
## PRODUCT / DISTRIBUTION (parallel track, not blocking features)
═══════════════════════════════════════════════════════════════
- [ ] landing/demo page (terminal-aesthetic, live demo seed)
- [ ] lite (open-source core) vs pro (one-time) split — generate lite by stripping pro
- [ ] "why own-once vs subscription" one-pager · docs site
- [ ] optional turnkey: pre-imaged Raspberry Pi

═══════════════════════════════════════════════════════════════
## RATIONALE (why this order)
═══════════════════════════════════════════════════════════════
- Phase A is all standalone, no backend, reuses existing engines → fastest wins, and
  leads with the galaxy graph the user wants most.
- Phase B closes the last real inventory gaps (custody, attribution, purchasing) that a
  working shop hits — medium effort, high utility.
- Phase C (scanning/mobility) multiplies B and R2, so it comes after them.
- Phase D (multi-user) is gated on the user actually running a server ("later").
- Phase E (discovery) is delight, best once the core is stable.
- Distribution runs in parallel whenever there's appetite; it's not a code dependency.

═══════════════════════════════════════════════════════════════
## TRACKS (added 2026-09-06 — repo went to git, two branches)
═══════════════════════════════════════════════════════════════

### `html-demo` — the free demo (FROZEN)
Frozen at tag `html-demo-v20.2` = the full single-file HTML app as it shipped.
Public-facing: upload for feedback/views. No new features land here.
- [ ] D1 strip-down pass before publishing: decide what the demo does NOT get
      (candidates: photos, cycle-count, physical .db mirror, server sync, galaxy)
- [ ] D2 demo-mode guard: seed data only, cap item count, "get the full version" nudge
- [ ] D3 landing page + short screen-capture clip

### `main` — INV.OS the product (the exe)
Single Go binary. Embeds the UI, owns a real SQLite database, serves itself on the
LAN so shop tablets/phones hit the same inventory. Same codebase becomes the SaaS.
- [ ] P1 scaffold: go:embed UI, SQLite schema (relational, not blob), REST API
- [x] P2 port the UI off the in-memory JSON blob onto the API (the RAM fix)  DONE v21.1
      core loop ported; see P5-P7 for what is still gated off
- [ ] P3 legacy import: read a v20.2 browser export / invos.db straight in
- [x] P4 stress test: 100k items — RAM ceiling, query latency  DONE v21.0
- [ ] P5 LAN mode: bind 0.0.0.0, device discovery, concurrent-edit behavior
- [ ] P6 packaging: signed .exe, Linux + Pi builds, one-command install
- [x] P5 projects / BOM: store+API writes, un-gated project/build/pick  DONE v21.2
- [ ] P6 cycle count: move counted/countlog into the database, un-gate `count`
- [ ] P7 spreadsheet import: wire the wizard to POST /api/items/bulk (endpoint exists)
- [ ] P8 photos: move from per-browser IndexedDB into the database
- [ ] P9 SaaS: multi-tenant behind the same Store interface (Postgres driver swap)

Postgres is NOT planned for the shop product — SQLite handles the volume a shop will
ever reach. It comes in only if/when SaaS multi-tenancy needs it, which is why all
data access sits behind one Store interface from day one.
