# INV.OS — Roadmap v2  (restructured by build priority)

═══════════════════════════════════════════════════════════════
## WHERE WE ARE  (updated 2026-09-08 · v25.9)
═══════════════════════════════════════════════════════════════

This file has grown a lot. Read THIS block; everything below is detail.

### The product works. It is not published.

Nothing in the build is blocking a release. What is missing is the launch itself.

**The port is finished and audited** — P1-P8. One Go binary, embeds the UI, owns a real
SQLite database, serves the LAN. Full feature parity with the old HTML app, everything
writes to the database, nothing gated. 100k items: search 2ms, home 0ms, flat memory.

**Since the port:**

| | |
|---|---|
| P9 legacy import | **done** v25.3 — move a shop off the old HTML build, C-IDs kept |
| P10 packaging | **all but signing** v25.4 — versioned cross-builds, rewritten kiosk scripts |
| B2 who did what | **done** v25.6 — `who`, attributed log, `recent by <name>` |
| security pass | **done** v25.5 — https for shop access, CSRF, rate limiting, headers |
| mobile / tablet | **done** v25.5 — stacks below 760px, real touch targets |
| load speed | **done** v25.5 — 288KB → 95KB, usable in ~300ms |
| onboarding | **done** v25.8 — `tutorial`, a six-step guided tour |
| the demo | **done** v25.9 — GENERATED from the product, not a forked branch |
| licence | **done** — AGPL-3.0 |
| MANUAL / README / RELEASE | **written** |

### What is actually next, in order

1. **Publish the demo.** RELEASE.md is the checklist. The only real work left is the
   landing page, a galaxy screenshot, and replacing `sourceURL` with the real repo.
   Everything in this roadmap about what shops need is a hypothesis until a stranger
   uses it.
2. **C1 scanning as a MODE** — the step a spreadsheet cannot take, and the most
   persuasive thing to film.
3. **B1 custody** — "who has the tool" is the most relatable feature to describe.
4. **B3 reorder → buy list** — the first time the app saves money instead of recording it.
5. **A3 valuation** — needs a real `cost` column; it is the number an owner asks for.

**Not next:** P11 (LAN hardening) and P12 (SaaS) are real but nobody is waiting on them.
P10's Windows signing is blocked on buying a certificate, not on work.

### The open question this cannot answer

The plan above is reasoned from forum posts. One shop running the legacy import on real
data outranks all of it — which is why publishing the demo is item 1 and not item 6.

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

### B2 — R4 Operator identity + attributed audit trail  [x] DONE v25.6
"Who took the last one" is the single most-asked question in a shared shop, and every
other accountability feature is downstream of it. The plumbing is already half built:
`log.operator` EXISTS in schema.sql and is written as '' by every path today.

The log is also already the undo stack and already records WHAT changed, in `text` and
in the `undo` payload. So this is not a new subsystem — it is filling in a column and
giving people a way to set it.

- [x] `who <name>` sets the operator for this DEVICE, remembered like a display setting.
      A bench tablet is "bench", the office PC is whoever is at it. No password.      v25.6
- [x] stamp every mutation — the operator rides in the CONTEXT, not through nineteen
      call sites and every Store signature. One change at appendLog, one at the edge.
- [x] `recent by <name>` (filtered in the DATABASE, not in the page) · `cid` filter for
      one item's whole history · operator column in the log screen and in `export`
- [ ] item detail shows "last touched by X, <time>" — the answer where the question is
      asked, rather than making someone go and read a log
- [x] `who` with no argument reports who this device is set to; `who -` clears it
- [x] a mutation with no operator set is still recorded, unattributed — refusing the
      write would teach people to work around the app

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

### C2 — R10b Mobility  [~ layout done v25.5, screens not]
- [x] responsive/touch layout (bigger targets, on-screen quick actions)          v25.5
      Graph stacks below 760px, 34px touch targets, 16px input so iOS does not zoom,
      safe-area insets. A real 46px sideways scroll on phones was found and fixed.
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
- [x] R11.4 interactive tutorial (`tutorial`): skippable/re-runnable 6-step walkthrough
      DONE v25.8 — see M7. Promoted out of DEFERRED because onboarding is the single
      biggest lever on whether a stranger becomes a user.
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
## AUTHENTICATION — WHAT IT IS AND WHAT IT COULD BE (added 2026-09-08)
═══════════════════════════════════════════════════════════════

### What exists now (v26.2)

One shared key, gating the network only. Loopback is exempt because whoever is at the
station can read the database file anyway. A device holds the key in its own storage and
sends it as a header; `key <value>` sets it and verifies before confirming.

It decides **whether** somebody gets in, never **who** they are. `who <name>` records who
did something, and is a claim rather than a credential.

### Where injection stands

Audited by attack, not by reading — `test/ui/injection-probe.mjs`, 11 checks, six payloads
in every typable field rendered through every screen. Nothing executes. The UI has one
`esc()` and builds DOM with `textContent` everywhere else; the SQL sort column is an
allowlist and every value is parameterised. **This is not the weak part.**

### The next rungs, in the order they are worth doing

- [ ] **A1 — per-device keys instead of one shared key.** One secret for the whole shop
      cannot be revoked for one lost tablet without re-keying every other device. Issuing
      a key per device makes "that phone left with someone" a one-line fix. Small, and it
      is the first thing a real shop will ask for.
- [ ] **A2 — a pairing flow.** Typing a long key on a tablet keyboard is where people give
      up and pick something short. Show a QR on the station containing a one-time code,
      scan it, the device gets a key. The scanner already exists.
- [ ] **A3 — rate-limit and back off failed keys specifically.** The global limiter would
      let a patient attacker grind a short key. Failed attempts should slow down hard and
      say so, which also makes a shop's own typo obvious rather than mysterious.
- [ ] **A4 — read-only devices.** A tablet in the corridor that can look up a bin but not
      change a quantity covers a real case and needs no account system — just two kinds of
      key.
- [ ] **A5 — real accounts (Phase D).** Only when `who` genuinely has to be trustworthy:
      a dispute, an auditor, or a customer whose insurer asks. It brings sessions, password
      storage, reset flows and lockout policy — a large surface, and everything above
      delivers most of the value without it.

### The line

Do not build a login because it sounds more secure. A shop is not a bank, and every step
toward accounts is a step toward the setup burden that keeps people on spreadsheets. Build
A1 and A2 because they solve real shop problems — a lost tablet, a keyboard nobody wants
to type on. Build A5 only when somebody's actual situation requires it.

═══════════════════════════════════════════════════════════════
## FINDING AND STORING PARTS (added 2026-09-08)
═══════════════════════════════════════════════════════════════

Asked: can storage and finding be improved. They are the two things the product exists to
do, so yes — but the useful answer separates cheap wins from architecture.

### Where finding is already strong

Search is FTS5 with the **trigram** tokenizer, so any fragment matches anywhere — type
`sist` and find resistors. Fragments under 3 characters fall back to LIKE. It searches
name, value, package, part number, notes, bin and C-ID together, and `Norm()` folds Ω→ohm
and µ→u so people find things they cannot type. At 100k items it answers in 2ms.

The gap is not speed. It is the searches that return NOTHING.

### F1 — rescue a failed search  ★ cheapest real win
Today a miss says "no matches — add it". That is a dead end at the exact moment the person
most needs help, and the most likely cause is a typo or a word choice, not an absence.
- [ ] on zero results, retry loosely and offer **"did you mean"**: same trigram index,
      lower the bar (any two of the query's fragments), rank by overlap
- [ ] if the query has several words, retry with each on its own — "10k resistor" failing
      when the item is called "Resistor 10kΩ 1/4W" is a fixable disappointment
- [ ] show the nearest few by name distance before offering to add
No schema change. This is the single highest value-per-hour item on this page.

### F2 — the shop's own words
Every shop calls things something. "Cap" is a capacitor to one person and a bottle cap to
another; nobody wants to type "socket head cap screw".
- [ ] an `alias` field on an item, folded into the search haystack like the others
- [ ] `also <cid> <word>` to add one in a second, from the row that just failed to match
- [ ] optional shop-wide synonyms in meta (`cap = capacitor`), applied at query time
This is how a search stops being a text match and starts being *this shop's* index.

### F3 — where should this go?
`add` picks the next free bin in a department. It does not use what the shop already knows.
- [ ] suggest a bin from where SIMILAR items already live — a new resistor belongs with
      the resistors, and the trigram index can already tell you that
- [ ] `where <thing>` — answer the physical question directly: department, shelf, drawer,
      and what else is in there
- [ ] `bins free [dept]` — where is there room

### S1 — one part, two places  ★ the real storage limitation
An item has ONE bin. Real shops have overflow: the working stock in the drawer and a box
of 500 on the high shelf. Today that is two items with the same name, which quietly breaks
low-stock, the BOM, and every count.
- [ ] a `locations` table: (cid, bin, qty), one row per physical place
- [ ] `bin` on the item becomes the PRIMARY location, so nothing above it changes at first
- [ ] `move <cid> <bin> <qty>` splits; `take` draws from the primary and says where else
      to look when it runs out
This is the one item here that is genuinely architectural: it touches the item shape, the
shelf counts, the graph and every screen that says "the bin". Worth it, but not before the
demo teaches us whether shops actually ask for it.

### S2 — the drawer is full
- [ ] optional capacity per bin, and a warning when filing into a full one
- [ ] `map` shows fill, so a reorganisation has somewhere to start

### Recommended order
**F1, then F3's `where`, then F2.** All three are small, none touch the schema except an
alias column, and together they change search from "a text match" into "it knows my shop".
**S1 waits for evidence** — it is the right answer to a question no real user has asked us
yet.

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

### `html-demo` — the free demo (SUPERSEDED 2026-09-08)
Frozen at tag `html-demo-v20.2`. **The branch is now a historical artifact, not the demo.**

The demo is GENERATED FROM `main` instead — `demo/build-demo.sh` takes the product's own
`internal/web/ui/index.html` and appends one script that answers `DB.req` in the browser.
Every UI method funnels through that single function, so the entire server dependency was
one line, and the demo needs no copy of the interface at all.

Why this replaced the frozen branch: keeping a second, diverging 6,000-line UI alive purely
to have something to show people is a tax paid forever, and the demo drifts from the
product exactly when it matters most. Everything built since the freeze — the mobile
layout, the guided tour, the captioned graph export, `who` — was already missing from it,
after two days.

The branch stays for history. Nothing new lands there.

**Revised 2026-09-08 — D1 as originally written is probably wrong.** "Decide what the demo
does NOT get" builds crippleware, and crippleware converts badly: someone who bounces off
a demo does not come back to find out whether the paid one is better. Worse, the strongest
hook on the whole product — the galaxy graph — was on the list to remove.

The demo should be FULLY FEATURED and LIMITED IN DATA. The reason to buy is then not "the
demo is missing things" but the true reason: **it is yours, it runs on your machine, it
holds your whole shop, and nobody can take it away.** That is an argument that survives
contact with a sceptical buyer; "we removed photos" is not.

- [ ] D1 demo posture: everything on, nothing removed. Cap at ~150 items, seeded, and
      say so plainly. Nothing hidden behind a "pro" label.
- [ ] D2 demo guard: seed on load, cap the item count, and one honest line about what the
      full version gives you — not a nag, and never a modal over the first screen
- [ ] D3 landing page + a short screen-capture clip (the galaxy graph is the clip)
- [ ] D4 the demo is a REAL build, not a mock: the browser build already stores to
      localStorage, so a visitor's tinkering survives a refresh. That is the moment it
      stops feeling like a screenshot.
- [ ] D5 `feedback` command in the demo only — one keypress from the thing they are
      annoyed by to telling us about it. The demo exists to collect this.

═══════════════════════════════════════════════════════════════
## MARKETING AS PART OF THE PRODUCT (added 2026-09-08)
═══════════════════════════════════════════════════════════════

Stated goal: marketing should be built INTO the product rather than bolted on after it is
finished. That is the right instinct, and for this product it is unusually achievable —
because the things that sell it are things it already does.

**The order matters, though: publish the demo NOW, not when the product is done.** The ERP
section above is reasoning from forum posts, which is a hypothesis. Every week the demo is
unpublished is a week of building on a guess. The demo is the cheapest evidence available
and it already exists, frozen and working.

### M1 — the artifacts the product already makes
The app has three things that are marketing material for free, and none of them need a
marketing department:

- [ ] **`graph png`** already exists. The galaxy view is the hook — it is the thing that
      makes someone stop scrolling, and it is generated from real inventory. Make the
      export shareable-shaped (sensible size, the shop name, a small wordmark) and it
      becomes a picture people post for us.
- [ ] **the report / `export`** — a shop that prints a valuation or a low-stock list is
      handing the app to whoever else reads it. Put a discreet footer line on printed
      output; a label sheet is seen by everyone who walks past the drawers.
- [ ] **QR labels** are physically in the shop, on every drawer, forever.

### M2 — the demo IS the pitch
- [ ] no signup, no email wall, no "book a demo". The entire competitive claim is
      "instant, yours, no account" — a signup form contradicts the product in the first
      five seconds
- [ ] deep links that open a specific view (`?demo=galaxy`) so a post can point at the
      thing being talked about
- [ ] "download the real one" is one line in the app, not a banner

### M3 — the writing already exists, publish it
- [ ] `MANUAL.md` is the docs site. It was written to be read by a user, not a developer.
- [ ] `NOTES.md` is a changelog with REASONING in it — "we measured, it was garbage
      collection, here are the numbers". For a technical audience that is more persuasive
      than any feature page, and it is already written as a side effect of working.
- [ ] the honest limits sections (MANUAL §6 and §10) are a trust asset. Publish them
      as-is. Saying what it will not do is what makes the rest believable.

### M4 — know what happens in the DEMO, and nothing in the product
A real distinction that must not blur:

- [ ] the demo is a public web page: basic analytics there are fine and necessary
- [ ] **the product ships with no telemetry, ever.** "No internet, no account, no phoning
      home" is a stated selling point; adding analytics to the exe would sell out the
      thing being sold. If usage data is ever needed from the product it must be an
      explicit, off-by-default, user-initiated export.
- [ ] measure the one thing that matters in the demo: did they type a command? People who
      type are people who understood it.

### M5 — the migration story is the sales pitch
P9 (legacy import) is a feature AND the whole argument to a spreadsheet shop:
- [ ] a page that is literally "bring your spreadsheet" — `template`, `import`, done in
      five minutes, with the dry-run screenshot showing it refuses to guess
- [ ] the ladder from THE ERP QUESTION is the pricing/positioning story: import → labels
      → who has what → buy list → valuation

### M6 — where these people actually are
- [ ] the forums the ERP observation came from. Not ads — answering the "how do you track
      inventory" threads with the demo link is on-topic and free.
- [ ] r/functionalprint, maker and machinist communities: the galaxy screenshot plus
      "one exe, no account, your data" is the whole post
- [ ] a build log is a genuine artifact: the graph performance work (1702ms → 17ms), the
      GC hunt, the orbit maths. That audience buys tools from people who work like that.

### M7 — sellability from what is ALREADY built (added 2026-09-08)

Asked: which existing features would most improve sellability. Ranked by value per hour,
not by size:

- [x] **captioned graph export** — DONE v25.7. `graph png` was a raw dump of the pane:
      odd shape, and nothing in the image said what it was. It now carries the shop name,
      the view, the count and the product name. Every shared screenshot is now an ad that
      explains itself, which is the cheapest marketing this product will ever get.
- [x] **a guided first run** — DONE v25.8. `tutorial`, six steps, offered automatically
      after the "just start" and "explore the demo" doors. It WATCHES the command line
      rather than driving it: wander off and the step waits, come back and it is still
      there. `skip` leaves, `tutorial` returns. R11.4 in DEFERRED is now this.
- [ ] **`cost` per item + valuation** (part of A3). "What is all this worth" is the
      question an OWNER asks, and the answer is needed for insurance and year-end. The
      `value` field is the part's rating (10kΩ), not money — this needs a real `cost`
      column, which is the one schema change on this list.
- [ ] **B1 custody** — not the biggest feature, but the most RELATABLE one to describe to
      a shop in a sentence: "it tells you who has the tool."
- [ ] **a demo seed that looks like the buyer's shop.** The seed is electronics-flavoured.
      A machinist opening it sees somebody else's inventory. Cheap to add variants.
- [ ] **printed output carries a discreet footer.** A label sheet and a low-stock list are
      seen by everyone who walks past; they are already leaving the building.

Deliberately NOT on this list: anything that adds setup. Every feature that makes the
first run longer costs more than it earns.

### Where to publish (added 2026-09-08)

Stated as the hardest part. The honest answer is that ONE channel done properly beats six
done thinly, and for this product the first channel is not a close call.

**1. r/selfhosted — do this first.** A single Go binary, no account, no cloud, owns a
   SQLite file you can copy. That subreddit's entire value system is this product's
   feature list. It is also large, active, and its readers install things the same day.
   One post there is worth more than a month of everything else.

**2. GitHub — not a channel, the substrate.** Nobody discovers you here, but everybody
   verifies you here, and every other channel points at it. Needed BEFORE posting
   anywhere: release binaries (P10 `build.sh` produces them), a README that opens with
   the galaxy image, repo topics (`inventory`, `selfhosted`, `sqlite`, `golang`), and
   `MANUAL.md` linked. Then submit to **awesome-selfhosted** — a slow, permanent trickle
   of exactly the right people, forever.

**3. Hacker News, Show HN — one shot, high variance, worth taking.** The build-log
   material is precisely HN's taste: 1702ms → 17ms, the GC hunt, "I built a fix for the
   wrong cause and measured it". Go after the r/selfhosted round has fixed the obvious
   complaints, because HN gets one attempt.

**4. The forums the ERP observation came from.** Answering "how do you track inventory"
   threads is on-topic, free, evergreen, and the person asking has the problem TODAY.

**5. Maker communities** — r/machinists, r/hobbycnc, r/electronics, r/3Dprinting,
   r/functionalprint. Different framing: the galaxy screenshot, not the architecture.

**Instagram: skip it, for now.** The galaxy view is genuinely photogenic, so the instinct
is right — but nobody adopts inventory software from IG, and it costs a posting habit to
maintain. A 60-second clip is worth making; embed it in the posts above rather than
building an IG audience. Revisit only if a maker audience already exists there.

**What to have ready before the first post** (traffic with nowhere to land is wasted):
- [ ] the demo live, on a URL, no signup (D1-D3)
- [ ] GitHub release with binaries for win/linux/arm64, and checksums
- [ ] a README whose first screen is the galaxy image and one sentence
- [ ] a 30-60s clip: type a search, print a label, open the galaxy
- [ ] be free for the four hours after posting — answering comments IS the launch

**Post shape that works in these places:** what it is in one line, why it exists in two,
the screenshot, the demo link, the source link, and the limits stated plainly. The
"what it will not do" section is an asset here — that audience has been burned, and
saying it first is what makes the rest credible.

### The sequencing recommendation

1. **Publish the demo now** (D1-D3), with the revised posture above. It is frozen and
   working; the only work is the guard and a page.
2. **Keep shipping `main`.** The demo does not block it and never should.
3. **Do B2 next in the product** — attributed logging. Cheap, and "who took the last one"
   is the most relatable feature to describe to a shop.
4. **Then C1 scanning.** It is the step a spreadsheet cannot take, which makes it the
   most persuasive thing to film.
5. Let what the demo teaches reorder everything below that.

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
