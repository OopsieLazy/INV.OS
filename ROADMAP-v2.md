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

### B2 — R4 Operator identity + attributed audit trail  ★ do this before B1 and B3
"Who took the last one" is the single most-asked question in a shared shop, and every
other accountability feature is downstream of it. The plumbing is already half built:
`log.operator` EXISTS in schema.sql and is written as '' by every path today.

The log is also already the undo stack and already records WHAT changed, in `text` and
in the `undo` payload. So this is not a new subsystem — it is filling in a column and
giving people a way to set it.

- [ ] `who <name>` sets the operator for this DEVICE, remembered like a display setting.
      A bench tablet is "bench", the office PC is whoever is at it. No password.
- [ ] stamp every mutation: `appendLog` takes the operator, every call site passes it
- [ ] `recent by <name>` · `recent <cid>` (this item's whole history) · operator column
      in the log screen and in `export`
- [ ] item detail shows "last touched by X, <time>" — the answer where the question is
      asked, rather than making someone go and read a log
- [ ] `who` with no argument reports who this device is set to
- [ ] a mutation with no operator set is still recorded, marked "unattributed" — refusing
      the write would teach people to work around the app

**Be honest about what this is.** `who <name>` is ATTRIBUTION, not authentication:
anyone can type any name. That is the right trade for a shop where nobody is trying to
lie, and it is not good enough for anything that has to survive a dispute or an auditor.
Real identity needs Phase D. The UI should never call it "audit" in a way that implies
more than it delivers.

Depends on nothing. B1 (custody) and the reorder history in B3 both want it first.

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
## THE ERP QUESTION (added 2026-09-08)

Raised from forum reading: most companies still run inventory on spreadsheets, and the
alternative everyone names is an ERP. Should INV.OS grow toward one — shipping links,
reorders, purchase orders, full logs?

### The observation is right, and it is the whole opportunity

People stay on spreadsheets because ERPs are the only thing above them, and an ERP is a
project: seat licences, an implementation, a consultant, months before anyone benefits.
A shop with 4,000 parts and six people does not clear that bar, so it stays on a
spreadsheet it knows is wrong. **The gap is not "no software exists" — it is that the
next rung up the ladder is three metres high.**

That gap is what this product is for. Nothing here should be aimed at competing with
NetSuite or Fishbowl on features; it should be aimed at being the rung.

### But "grow into an ERP" is the wrong instinct

ERP means finance, purchasing, receiving, HR and CRM sharing one ledger. Almost none of
that is inventory, all of it is regulated or accounting-adjacent, and each piece drags in
multi-user permissions, approval chains and an audit trail that has to hold up to an
outside party. Chasing it would:

- destroy the thing that makes this good — it opens instantly, needs no account, and one
  person can run it. Every ERP feature is a reason to add setup;
- start a fight with entrenched vendors who have sales teams and integrations, on their
  ground rather than ours;
- and the RAM rule, the single-file design and "no accounts" all become obstacles rather
  than advantages.

### The line

**INV.OS owns the physical question: what is here, where is it, who has it, how much is
left.** It integrates outward for everything else rather than absorbing it — export, an
open API, files a person can hand to their accountant. It should be the system of record
for STOCK, and never try to be the system of record for MONEY.

Applied to the specific asks:

| ask | verdict |
|---|---|
| **attributed logs (who did what)** | **Yes, and first.** B2. Cheap — the column exists — and everything else depends on it. |
| **reorder points → a buy list** | **Yes, highest-value item on the board.** B3. Turns data already held into money saved, needs no new architecture, and it is the thing spreadsheet users cannot do at all. |
| **"how to order" / supplier links** | **Yes, cheap.** `supplier`, `source` and `link` are ALREADY fields on every item. `reorder` grouping by supplier with the link beside each line is most of the value of purchasing, for none of the cost. |
| **labels** | **Already shipped**, and the foundation for scanning (C1). Deepen rather than extend. |
| **full logs** | **Already shipped** — the log is unbounded and IS the undo stack. B2 adds the missing "who". |
| **valuation (qty x unit cost)** | **Yes.** A3. Cheap, and it is what year-end and an insurance claim actually need. |
| **purchase orders with approval + receiving + three-way match** | **No.** That is real purchasing, and it is where ERP scope begins. A printable PO per supplier (B3) is the honest stopping point. |
| **carrier shipping — rates, labels, tracking** | **No, unless the shop ships product.** That is a different product (ShipStation and friends) and a pile of carrier integrations. A maker shop CONSUMES inventory; it does not ship it. Revisit only if a real user ships. |
| **accounting integration (QuickBooks / Xero)** | **Not now.** Export is the integration. Real sync means matching a ledger, and being wrong there costs someone their books. |
| **multi-warehouse, lot / serial / expiry tracking** | **No.** These exist for regulated and food/pharma inventory. Adding them for one hypothetical customer taxes every screen for all the others. |

### What the ladder actually looks like

The sellable story is a migration path, not a feature list — each rung useful on its own:

1. **Import your spreadsheet** (done). The first five minutes have to beat the thing they
   already have.
2. **Print labels, scan them** (labels done, C1 next). This is the step a spreadsheet can
   never take, and it is where the app stops being a nicer spreadsheet.
3. **Know who has what** (B2 + B1). The shared-shop pain.
4. **Turn low stock into a buy list** (B3). The first time the app saves money instead of
   recording it.
5. **Tell you what it is all worth** (A3). Year-end, insurance, and the number an owner
   actually asks for.

Anything that does not sit on that ladder is a distraction until the ladder is finished.

### The one thing that would change this answer

If a real shop says "we cannot use it because it does not do X", X moves. This section is
reasoning from forum posts, which is a hypothesis, not evidence. The fastest way to
invalidate all of it is to get one shop running P9's legacy import on real data.

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

DONE — the port is finished and AUDITED (v24.1 re-checked every item below against a
test rather than trusting the checkbox; three of them were not actually done).
- [x] P1 scaffold: go:embed UI, SQLite schema (relational, not blob), REST API   v21.0
- [x] P2 port the UI off the in-memory JSON blob onto the API (the RAM fix)      v21.1
- [x] P3 stress test: 100k items — RAM flat, search 2ms, home 0ms                v21.0
- [x] P4 projects / BOM in the database                                          v21.2
      · build made atomic (one transaction, one undo) — v24.1
- [x] P5 cycle count                                                             v22.0
- [x] P6 spreadsheet import                                          v22.0, tested v24.1
- [x] P7 photos in the database                                                  v22.0
- [x] P8 galaxy + orbit as settings; the no-galaxy fork is deleted    v22.1, done v24.1
- [x] department / shelf renames reach the database (was memory-only)            v24.1
- [x] graph scales to 20k nodes; grid physics + pixel rendering                  v23.0
- [x] settings audit: everything applies live and survives a reload              v24.0-24.2
- [x] test harness: 108 end-to-end UI checks + 36 settings checks, plus
      benchmark / rewind / orbit / staleness / update-notice probes

★ NEXT — nothing here is a port; it is all "make it shippable".

### P9 — legacy import  [x] DONE v25.3
Existing data is stranded in the HTML build's localStorage. Until this exists, nobody
(including us) can move a real inventory onto the exe.
- [x] read a v20.2 browser export (the JSON the old `export`/`backup` produced)
- [x] read an old physical invos.db written by the sql.js mirror
- [x] `import legacy <file>` — map old fields, keep original C-IDs, one undo step
- [x] round-trip test: old export in, item/bin/qty/project counts match
Also handles the checksummed envelope and the blob-server response, because the old build
wrote the same inventory in four shapes. Two-step: a dry run reports what would happen
(and every row that cannot come across) and writes nothing until `import legacy confirm`.

### P10 — packaging  [~ mostly done v25.4]
- [x] version stamping (-ldflags) + `invos -version` in releases, not "dev"   `build.sh`
- [x] cross-builds: windows/amd64, linux/amd64, linux/arm64 (Pi), darwin/arm64
      Pure-Go SQLite means a Windows box builds a working Pi binary with no toolchain.
- [ ] code signing for Windows, so it does not trip SmartScreen
      BLOCKED, and not on effort: it needs a PURCHASED code-signing certificate (OV is a
      few hundred a year; EV clears SmartScreen immediately). Nothing in the repo can
      substitute for it. `build.sh` prints that the binaries are unsigned rather than
      letting a buyer find out from Windows.
- [x] REWRITE kiosk/install.sh + update.sh — no python, no index.html, no service-worker
      cache. One binary + one user systemd unit, with lingering so it survives logout.
- [x] one-command install for a shop box; auto-start on boot
      install.sh waits for /api/health and fails loudly; update.sh copies the database,
      keeps the outgoing binary and ROLLS BACK automatically if the new one will not start.

### P11 — LAN for real  ★ NEXT

`-lan` works and prints the URLs, but it has only been exercised by two browser tabs
on localhost. Before promising it to a shop:
- [ ] two real devices editing at once — concurrent-edit behaviour, stale views
- [ ] what a tablet sees when the server goes away mid-edit
- [ ] make the frames stop when idle (the graph redraws every frame because of drift;
      real battery cost on a tablet) — see NOTES v22.1
      NOTE (v25.1): `pause when idle` no longer parks the loop while the drift is
      running, because parking it was silently stopping the auto-orbit a second after
      the graph opened. `auto-orbit 0` parks it. For a tablet the right answer is
      probably to ship a shop default with auto-orbit off rather than to re-park a
      scene that is visibly moving.
- [ ] optional: mDNS/discovery so a phone finds the station without typing an IP

### P12 — SaaS
- [ ] multi-tenant behind the same Store interface (Postgres driver swap)
Postgres is NOT planned for the shop product — SQLite handles the volume a shop will
ever reach. It comes in only if/when SaaS multi-tenancy needs it, which is why all
data access sits behind one Store interface from day one.

### Still open from the original feature roadmap (Phases B/C above)
Not port work — genuinely new capability, in rough value order:
- [ ] B2 operator identity + attributed log (WHO did it) — cheapest, and everything
      else below depends on it; `log.operator` already exists in the schema
- [ ] B1 check-out / check-in custody (who has the tool, where is it now)
- [ ] B3 suppliers + reorder points -> a real buy list grouped by supplier
- [ ] C1 scanning as a MODE (scan -> take / stock / count), USB wedge scanners
- [ ] A3 reporting: most-taken, stale stock, consumption rate, valuation

See "THE ERP QUESTION" above for why the order is B2 -> C1 -> B1 -> B3 -> A3 and what is
deliberately NOT on this list (purchase orders with approvals, carrier shipping,
accounting sync, lot/serial tracking).
