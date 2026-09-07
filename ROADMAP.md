# INV.OS — Roadmap
A local-first, keyboard-first, offline inventory terminal. Single HTML file + optional
kiosk/PWA deploy. This roadmap tracks the path from "personal tool" to "robust local
alternative to the inventory SaaS products (Sortly, inFlow, Zoho, Katana, etc.)."

Positioning (from the 2026 market audit): the SaaS tools win on mobility, photos,
multi-user, and purchasing. INV.OS wins on speed (keyboard-first), a spatial bin
catalog (Dewey D-S-BB), true offline/self-hosted ownership, no subscription, and a
hardened data-integrity layer. The roadmap closes the SaaS feature gaps WITHOUT giving
up those edges.

Legend: [x] done · [~] partial · [ ] todo

============================================================
## SHIPPED (baseline)
============================================================
[x] Dewey D-S-BB bins (dept · section · 2-digit bin), 100 bins/section
[x] Live search, unified cursor nav, ghost text, command menu, focused views
[x] Projects / BOM, build, shopping list, printable pick list
[x] Brain graph (2D + 3D holographic), 3 views (inventory / projects / project)
[x] QR label generation (verified against zbar) + camera scan (lookup)
[x] Themes (6) + settings screen + display toggles
[x] Data integrity: checksum envelope, dual-write+verify, fallback chain,
    10 rolling snapshots, health, rollback, boot self-check, off-machine reminder
[x] PWA install + File System Access auto-backup
[x] Arch/niri kiosk deploy kit + update workflow
[x] Name tidier + database doctor (dedupe/normalize)

============================================================
## GAP-CLOSING ROADMAP (vs SaaS competitors) — the 7 points
============================================================

### R1 — Photos per item  [x] DONE (v14.0)
Why: Sortly's whole identity is visual item records. "Which O-ring is this?" a photo
answers instantly. Highest perceived value, low effort.
- [x] `photo <id>` — capture from camera OR paste/drop an image
- [x] Store as downscaled data URL (cap ~100-150KB; resize on a canvas before save)
- [x] Show thumbnail on the info card
- [x] Show photo when a node is clicked in 2D AND 3D graph (the "ohitis"/hover-photo goal)
- [x] Graceful when absent (current text-only behavior)
- Integrity note: photos inflate the blob — consider a separate storage key per photo
  so the main state stays small and snapshot-friendly.

### R2 — Cycle-count / audit mode  [x] DONE (v14.0)
Why: entire product category now. Count a rotating subset on a schedule, verify vs
system, flag discrepancies. "Keep the numbers honest."
- [x] `count` — guided walk: shows a bin, you confirm or correct the qty
- [x] Discrepancy log (expected vs actual, timestamped, per-item)
- [x] Count scopes: whole shop, a dept, a section, "oldest-counted first"
- [x] `count due` — surfaces bins not counted in N days (rotating schedule)
- [x] Variance report + one-tap "apply corrections" (snapshot-undoable)
- [ ] Optional: scan-to-count (pairs with R6)

### R3 — Check-out / check-in (custody)  [ ]
Why: reusable tools/jigs leave for a job and come back. Track WHO/WHERE, not just qty.
- [ ] `out <id> <who|where>` / `in <id>` ; item shows "OUT @lathe-3" state
- [ ] "What's out right now" view; overdue flag if out > N days
- [ ] Ties into the activity log with the operator (R4)

### R4 — Operator identity + attributed audit trail  [ ]
Why: SaaS logs every action with a user; compliance/traceability needs it.
- [ ] `who <name>` sets the current operator for the session (lightweight, no auth)
- [ ] Stamp every mutation in the activity log with the operator
- [ ] `recent by <name>` filter; export includes operator column
- [ ] Groundwork for true multi-user later (see R8)

### R5 — Suppliers, reorder points, purchase workflow  [~]
Why: turn low-stock into ACTION (SaaS auto-triggers POs).
- [~] `low` list exists → extend into a reorder list
- [ ] Per-item: supplier, supplier SKU, unit cost, reorder point, reorder qty
- [ ] `reorder` — builds a purchase list grouped by supplier, with costs + totals
- [ ] Printable/exportable PO per supplier
- [ ] Reorder point drives the low/reorder surfacing (not just min qty)

### R6 — Scanning as a primary workflow  [~]
Why: SaaS is scan-first — scan to pick, count, check-out; the audit trail builds itself.
- [~] `scan` exists as lookup → make it a mode that feeds actions
- [ ] Scan → take / stock / count / check-out (mode-dependent)
- [ ] Continuous scan loop (scan many without re-triggering)
- [ ] External USB/BT scanner support (acts as keyboard wedge — mostly works already)

### R7 — Reporting / analytics / export depth  [~]
Why: "in-depth data on items, folders, user histories; export PDF/CSV for audits,
budgeting, forecasting."
- [~] CSV export exists → add report types
- [ ] Usage analytics from the activity log: most-taken, stale stock (untouched N mo),
      consumption rate, suggested min/reorder raises
- [ ] Valuation report (qty × unit cost) by dept/section/total
- [ ] PDF report export (reuse the print pipeline)
- [ ] Dashboard view / on-graph overlays

============================================================
## BEYOND THE 7 (bigger bets)
============================================================
### R8 — Multi-user / shared data  [~] (POC done: local-first adapter + Go/SQLite server; physical SQLite mirror shipped v17)
Current model is single-store, single-machine (by design). For 2+ stations or phones:
- [ ] Option A: tiny self-hosted backend (Node/SQLite) as the shared store
- [ ] Option B: shared file on the network + merge-on-load (conflict reconcile)
- [ ] Import-MERGE (not just replace) to reconcile external edits
- [ ] Per-user access levels
Note: pairs with the user's future "server + VPN" plan.

### R9 — Label ↔ reality round trip  [~]
- [x] print QR labels · [~] scan to open
- [ ] scan-to-count, scan-to-checkout, scan-to-restock (depends on R2/R3/R6)

### R10 — Spreadsheet on-ramp + mobility  [~] (a: DONE v15.0 · b: todo)
Why: the REAL competitor for small shops is Excel/Google Sheets + Sortly's one-click
spreadsheet import and phone-first scanning. This is where cold-pitch deals are won or
lost. Two fronts: (a) make leaving a spreadsheet effortless, (b) make a phone useful.

(a) Spreadsheet on-ramp — "bring your existing list in 60 seconds"
- [x] Smart CSV/XLSX import wizard: paste or drop a messy sheet, auto-detect columns
      (fuzzy-match headers: "Qty"/"Quantity"/"On Hand" -> qty, "Location"/"Bin" -> bin,
      "Desc"/"Item"/"Name" -> name, etc.), preview the mapping, let the user correct it.
- [x] Handle the common real-world mess: merged header rows, blank rows, trailing
      totals, mixed units, items with no bin (auto-assign via the keyword guesser).
- [x] Dry-run preview (what will be created / skipped / merged) before committing.
- [x] XLSX support (not just CSV) — most shops hand you an .xlsx. (SheetJS is inlineable.)
- [ ] Round-trip: "export to the same shape I imported" so they can hand a sheet back
      to an accountant/boss who still wants Excel.
- [x] Google-Sheets paste path: copy a range from Sheets, paste into an import box —
      tab-separated, parse it. Zero file handling.
- [x] Template download: a blank "start here" CSV/XLSX with the right columns.

- [ ] Competitor-migration import: recognize a Sortly / Zoho / inFlow CSV export
      specifically (map their known column names) so switching AWAY from a competitor
      is one step. DONE v18.1 — maps Sortly/Zoho/inFlow/Square headers (4/4 tested).

(b) Mobility — a phone becomes a companion, not the station
- [ ] Responsive/mobile layout of the terminal (already PWA-installable; needs the UI
      to reflow: bigger tap targets, on-screen quick-actions, no reliance on a keyboard).
- [ ] Phone-as-scanner mode: open the app on a phone, `scan` a bin/part label -> it
      acts on the SHARED data (depends on R8 multi-user for true sync; interim: phone
      hits the same LAN server, so it already sees live data once R8 lands).
- [ ] "Quick count" and "quick take" phone screens: minimal, thumb-driven, for walking
      the shop — the Sortly muscle-memory, but on your own hosted app.
- [ ] Offline-tolerant on mobile (PWA cache already helps); queue actions if the LAN
      server is briefly unreachable, sync when back.
- [ ] Camera-first add on mobile: shoot a photo, it prefills a new item (pairs with R1).
Note: true multi-device requires R8. Sequence R10(a) NOW (huge, standalone, no backend
needed), R10(b) mobility AFTER/with R8.

### R11 — Onboarding & first-run experience  [~] (trio DONE v18: first-run doors, setup wizard, demo separation, editable depts/sections)
Why: Sortly wins partly on "import a spreadsheet and you're running in 5 minutes,"
polished apps, and someone to call. A non-technical shop owner can't currently
self-serve past the seed data. This is the difference between a demo and a deal.

ACTIVE SCOPE (this build — the trio that makes it feel like THEIR shop in 2 min):
- [ ] Guided first-run: detect empty/seed-only inventory -> offer three doors:
      "import my spreadsheet" (uses R10a) · "start fresh" · "explore the demo".
- [ ] "Shop setup" wizard: name the shop, rename the 10 departments to their trades,
      name a few sections — taxonomy fits THEM immediately.
- [ ] Demo-vs-real separation: clear "DEMO DATA" banner + one-click "clear demo,
      start real" so nobody ships a shop on seed rows or leaks demo data in a shot.
- [ ] Backup nudge on first real use (fold in the existing health/off-machine check).

DEPLOYMENT onboarding (the paid-setup story — later):
- [ ] One-command installer polish + plain-English "SHOP SETUP" printable checklist.
- [ ] Optional pre-imaged Raspberry Pi SD image (turnkey, sellable).
- [ ] "why this vs subscription" one-pager (own-once, offline, no per-seat) for landing.

Note: the competitor-CSV migration importer moved to R10 (belongs with spreadsheets).
      The interactive tutorial + contextual hints + progress checklist are deferred to
      the DEFERRED section at the end of this roadmap.

============================================================
## PRODUCT / DISTRIBUTION (see chat for detail)
============================================================
- [ ] One-click "download & run" story (single HTML) + hosted-demo page
- [ ] Optional paid tier ideas (one-time license, "pro" build, paid setup/support)
- [ ] Docs site / landing page
- [ ] Anonymized demo seed vs real data separation

============================================================
## SUGGESTED BUILD ORDER
============================================================
1. [x] R1 Photos + R2 Cycle-count  (DONE v14 — photos feed the graph-click goal)
2. R10(a) Spreadsheet on-ramp  (NEXT — standalone, no backend, closes the #1 real
   competitor gap; makes every future cold pitch/demo land: "bring your sheet in")
3. R11 Onboarding first-run + shop-setup wizard  (turns the demo into a deal)
4. R3 Check-out  +  R4 Operator identity  (custody + attribution together)
5. R6 Scanning-as-workflow  (multiplies R2/R3)
6. R7 Reporting  (leverages the now-rich activity log)
7. R5 Suppliers/reorder
8. R8 Multi-user  (when the server/VPN exists)
9. R10(b) Mobility  (with/after R8 — phone as companion scanner)


============================================================
## R12 — Project Galaxy (visual show-and-tell)  [ ]  ← NEW idea, captured
============================================================
A separate 3D graph mode where PROJECTS render as small galaxy clusters — each project
a cluster of its parts — and over time you see a "universe" of projects and how they
interconnect through shared parts. A neat visual experiment + a show-and-tell area.
- [ ] New graph view `graph galaxy`: projects = cluster cores; their BOM parts orbit as
      stars; shared parts create bright bridges BETWEEN project clusters (the "how they
      interconnect" story). Reuse the existing 3D engine + themes/HUD.
- [ ] Time dimension: projects fade in by created date so you can watch the universe
      grow (scrub or auto-play). Uses project.created (already stored).
- [ ] Cluster visual: dept-tinted stars, low-stock parts pulse amber, active project
      brightest. Bridges thicker with more shared parts.
- [ ] Click a cluster -> drill into that project (existing single-project view).
- [ ] Performance: reuse the O(n^2) note — spatial grid if project/part count is large.

## R13 — Project docs & gallery  [ ]  ← NEW idea, captured
============================================================
Document projects as downloadable artifacts + a visual gallery.
- [ ] Per-project notes/writeup: a markdown-ish text field; `proj doc <name>` opens an
      editor; downloadable as a .md/.txt file (reuse the download plumbing).
- [ ] Project images: attach photos to a project (reuse R1 photo storage), shown in a
      small gallery on the project card + as the cluster's texture in R12.
- [ ] Export a project as a self-contained bundle (BOM + notes + images) — a "project
      card" others can open. Ties into the show-and-tell theme.

## R14 — Project discovery / inspiration feed  [ ]  ← NEW idea, captured
============================================================
Float in build suggestions from external project sources so the station also inspires.
Ref: are.na (channels of projects/ideas), retro-device build communities, maker repos.
- [ ] Curated local seed of project ideas (offline-first: ship a small JSON of
      "things to build" — retro devices, common electronics/maker projects — so it
      works with no internet).
- [ ] Optional online fetch (only when a server/net is present): pull from an are.na
      channel API or a maker feed into the idea pool. Strictly opt-in (offline default).
- [ ] "Catch the shooting star": occasionally a suggestion drifts across the graph/
      idle screen; click it to capture -> creates a project stub with a suggested BOM
      the user can flesh out. Playful, non-intrusive, dismissable.
- [ ] Match suggestions to what you HAVE: highlight ideas you can mostly build from
      current stock (uses the BOM readiness logic).
- OPEN QUESTIONS: which sources (are.na channel(s)? a static curated list first?);
  how much online vs pure-offline; how often a "star" appears (rare, opt-in).

============================================================
## DEFERRED — onboarding polish (later, after the R11 trio)
============================================================
These are the "learning the interface" items, parked until the core onboarding lands.
- [ ] R11.4 Interactive tutorial (`tutorial` command): skippable/re-runnable 6-step
      walkthrough — add item, search, take stock, make a label, run a count, open graph.
      Driven by the existing command system.
- [ ] R11.5 Contextual first-time hints: first time a screen opens, one dim dismissable
      tip; never nags twice. Teaches without a manual.
- [ ] R11.6 Getting-started progress checklist: a card that ticks milestones (first item
      added, first count run, backup set up) so a new user feels progress.
