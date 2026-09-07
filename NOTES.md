# INV.OS — Project Notes

## What this is
Single-file, black & white, CMD-style inventory terminal for personal projects.
Open `inventory.html` in any browser — no server, no install. Data saves automatically.

## ID system
- Format: `CATEGORY-###` (e.g. `TOOL-001`), category = 2–6 letters, auto-created on first use.
- Per-category counter stored in `state.seq`. **Numbers are never reused**, even after deletes,
  so an ID always refers to exactly one thing forever (safe for physical labels).

## Data model (one JSON blob)
```json
{ "items": [{ "id","cat","num","name","qty","loc","note","created" }],
  "seq":   { "TOOL": 12 } }
```

## Persistence — important
- In the browser preview it uses the artifact storage API.
- Opened locally it falls back to **localStorage** — data is tied to that browser on that machine.
- `export` copies a JSON backup to clipboard; `import {json}` restores it. Back up occasionally.
- `nuke confirm` wipes everything (intentionally hard to type by accident).

## Interaction cheatsheet
| Do | How |
|---|---|
| Add | `add tool cordless drill x2 @garage #needs battery` |
| Search | just type anything — filters live; `esc` clears |
| Stock | `qty TOOL-001 +3` or select row + `+` / `-` keys |
| Move / note / rename | `move ID @shelf2` · `note ID text` · `ren ID new name` |
| Delete | `del ID` then `y` (or select row + Delete key) |
| Browse | `↑↓` select, `enter` expand, `list`, `cats`, `help` |

## Design decisions
- Pure #000 / #f2f2f2, system monospace, faint scanlines + blinking block cursor (both
  disabled under `prefers-reduced-motion`). Selection bar is inverse video, classic terminal.
- Unknown commands are treated as searches — typing is never punished.
- qty 0 renders bold ("OUT") so empties pop while scrolling.
- Mobile-friendly: rows are tappable (tap = select, tap again = expand).

## Things noticed / future ideas
- Instagram reel couldn't be fetched directly (login wall) — styled from your description:
  scrollable cmd-like B&W text UI.
- Would port cleanly to a Raspberry Pi + small mono display (kiosk-mode Chromium), or to a
  Python curses version if you ever want it truly in a terminal. Say the word.
- Possible v1.1: CSV export, sort toggles, barcode/QR label printing from IDs, undo.

---

# v2 — COMPONENT INVENTORY (green phosphor, from footage review)

## Changes from v1
- Pure shell model: everything scrolls up above a persistent `inventory $ ` prompt.
  No live-filter — like a real terminal, Enter executes. Unknown input falls through to search.
- Green phosphor `#3df07a` on `#0b0e0c`, amber `#ffb000` warnings, white headings, CRT scanlines/glow.
- Bin-centric data model: name, category, BIN number, qty, min qty, value, package, part no, notes.
- Carried from v1: adaptive storage layer, block-cursor mirror input, y/n delete confirm,
  permanent short IDs (C-001…) usable anywhere a name is (nod to the v1 CATEGORY-NUM system).
- Command history (↑/↓), interactive field-by-field `add`/`edit` wizards, `take`/`add-stock`,
  `low` (amber), `bins`, `stats`, CSV `export`/`import` (multiline paste handled), `clear`,
  `reset confirm` restores the 12-item demo seed.

## Seed data
12 realistic components (Arduino Uno BIN 137, ESP32, 10k resistors, 100µF caps, OLED,
HC-SR04, jumpers, breadboard, TS101 iron, etc.) — `find uno` works on first load.
Seeding happens once; deleting items won't re-seed. `reset confirm` brings it back.

## Platform decision
Kept single-file web app for offline: opens from disk with zero dependencies, saves to
localStorage, and later runs unchanged on a tablet/Pi in kiosk mode. A native CLI would
lose tablet/touch use. Can produce a Python/curses twin later if wanted.

---

# v3 — Dewey-decimal homepage

- Homepage is now just: title, search prompt, and the ten-class index with live counts
  (banner and help wall removed — help lives behind `help`).
- Dewey framework: bin's first digit = class. 000 general, 100 resistors, 200 capacitors,
  300 ICs, 400 sensors, 500 modules, 600 boards, 700 connectors, 800 cables, 900 tools.
- Typing `1` or `100` opens the resistor shelf; a full bin like `137` opens that one bin.
  Index rows are also tappable on touch screens.
- `add` derives the class from the category answer and suggests the next free bin
  (xx10 upward) — accepting the default keeps the whole system self-organizing.
  Entering a bin outside the class prints an amber cross-shelf warning but allows it.
- `esc` = home from anywhere. Storage key bumped to compinv-v3 (fresh seed with Dewey bins);
  old v2 data can be moved over with export -> import.

---

# v4 — ease of use / ease of finding pass

## Finding
- LIVE SEARCH: results render under the prompt on every keystroke, no Enter needed.
  Top 8 shown; Enter prints the full set to scrollback. Tap/click any row -> info card.
- Token AND-matching: "10k res" finds Resistor 10kΩ. Unicode-normalized (µ->u, Ω->ohm)
  so "100uf" and "10kohm" work from a plain keyboard.
- `info <name|C-ID>` full detail card with quick-action hints.

## Adding
- One-line add: `add 10k resistor x50 [@bin]`. Class auto-guessed from keywords in the
  name (resistor/cap/ic/sensor/module/board/connector/cable/tool + common synonyms);
  bin auto-assigned as next free in that class. Only asks a question (single digit)
  when it can't guess. Duplicate names are caught and redirected to `stock`.
- `class 3 = 3D PRINTING` renames any shelf; labels persist. `classes` lists them.
- `move <name> <bin>` for quick rebinning without the edit wizard.
- Full edit wizard retained for details (value/pkg/part/notes).

## Data
- `category` field dropped from the model — class is derived from the bin digit, one
  less thing to keep in sync. CSV import accepts both old (with category col) and new.
- Storage key compinv-v4. Old data migrates via export -> import.

---

# v4.1 — real input field + cmd shortcuts
- Replaced invisible-input/mirror trick with a real visible input (green text, green
  caret) — robust with mobile keyboards, IMEs, and autocomplete. Blinking block cursor
  still shows when the line is empty.
- Standard cmd clearing: Ctrl+U clears the line, Ctrl+L clears the screen (home),
  Esc clears line / returns home (unchanged).

---

# v5 — undo + activity log
- Every mutation is logged with a timestamp: add, delete, take, stock, move, edit,
  import, shelf rename. `recent` shows the last 20 (newest first).
- `undo` (or `u`) reverses the most recent change; repeat to walk back up to 50 steps.
  Deletes restore the full item incl. its C-ID; edits restore the before-snapshot;
  imports remove the whole batch. `reset confirm` is the one thing not undoable.
- Log capped at 100 entries, undo stack at 50; both persist with the data.

## Next up (agreed roadmap)
1. DONE undo + activity log
2. Printable bin labels (print-ready sheet from data, optional QR)
3. Projects / BOM   4. Shopping list   5. PWA install + auto-backup

---

# v5.1 — Windows cmd / Alacritty look
- Palette switched to Windows Terminal's cmd defaults (Campbell): bg #0C0C0C, text
  #CCCCCC, dim #767676 (bright black), warnings bright yellow #F9F1A5, headings white.
- Removed the CRT effects entirely (glow, scanlines, vignette) — flat like real cmd.
- Font stack now leads with Cascadia Mono / Consolas.
- CSS var names kept (--green now holds gray) so no JS changes were needed.

---

# v5.2 — mouseless keybindings + video-gap review

## Gaps vs the original footage spec (status)
- ASCII banner + boot sequence: intentionally removed in the v3 simplification.
- Field-by-field interactive `add`: replaced by one-line quick add; full fields via `edit`.
  (Deviation by design — can restore as `add -f` if wanted.)
- Totals status line: NOW ADDED to the home screen (components · pcs · bins).
- Everything else from the spec is present or exceeded.

## New keybindings (mouseless station)
- Tab: completes commands (first word) and component names (later words); Tab cycles.
- ↓/↑: move a selection bar through live results (inverse video); ↑ past the top
  returns to typing, and from empty line arrows walk command history as before.
- On a selected result: Enter = info card, Ctrl+Enter = take 1, Shift+Enter = stock 1.
- Readline set: Ctrl+U clear line, Ctrl+W delete word, Ctrl+K kill to end,
  Ctrl+A/Ctrl+E start/end of line.
- PgUp/PgDn scroll the scrollback. F1 opens help. (Ctrl+L / Esc unchanged.)
- The live-results footer hints the active keys contextually.

---

# v5.3 — keyboard navigation on the home class index
- On the home screen, ArrowDown starts a selection bar on the ten shelves; once
  selecting, w/s also move it (arrows always work). Enter opens the shelf, Esc backs
  out. Typing anything cancels selection and searches as usual.
- 'w'/'s' deliberately do NOT start navigation from cold — with an empty prompt they
  type into search (so "sensor" is still reachable). They only steer once ↓ begins.
- ArrowUp on an empty, unselected prompt still recalls command history (shell habit).

---

# v5.4 — name tidier (consistent wording, no special keys needed)
- Every `add` runs the name through a tidy pipeline before saving:
  * units repaired from plain typing: 10k/10kohm -> 10kΩ, 100uf/100u -> 100µF,
    nf/pf, 5v -> 5V, 1/4w -> 1/4W, 16mhz -> 16MHz, 20ma -> 20mA
  * casing: acronyms uppercased (OLED, USB, SMD, THT, I2C…), part codes uppercased
    (ts101 -> TS101, ssd1306 -> SSD1306), known brands cased (ESP32, Arduino, DevKit),
    everything else Title Case; value tokens and things like 20cm left alone
  * word order: passives go type-first — "10k resistor" -> "Resistor 10kΩ"
    (only resistor/capacitor/inductor/potentiometer are reordered; boards/modules kept)
- `tidy` = dry-run diff of every stored name; `tidy apply` fixes all at once and is a
  single undo step. Verified against 10 realistic inputs (all pass).
- Duplicate detection now compares tidied names, so "10k resistor" and "Resistor 10kΩ"
  can never coexist.
- Names typed in the `edit` wizard are respected as-is (explicit intent).

---

# v5.5 — database doctor (normalize / dedupe)
- `doctor` (aliases: normalize, fsck) = full dry-run checkup in four sections:
  * names   — tidy pipeline diffs
  * fields  — value/pkg/part cleanup ("-", "n/a" -> empty; units fixed; whitespace),
              qty/min sanity (negative/NaN -> 0), out-of-range bins reassigned by class guess
  * duplicates — entries whose TIDIED names match are auto-merge candidates
    (survivor = oldest C-ID; qty summed, min = max, empty fields filled, notes joined)
  * review  — fuzzy pairs (token-set equal/subset, e.g. "OLED Display" ~ "OLED Display
    0.96\""): NEVER auto-merged, listed with a ready-made `merge` command
- `doctor apply` fixes all safe issues in one shot; a full items snapshot goes on the
  undo stack, so ONE undo reverts the entire operation.
- `merge <keep> <remove>` for the human-judgment pairs; also snapshot-undoable.
- `import` now suggests running doctor afterwards.
- Verified against a seeded messy dataset (dup, fuzzy pair, junk fields, bad bin/qty).

---

# v5.6 — warning system + theme polish
## Warning system (navigability)
- Titlebar badge: doctor's scan runs after every save; if issues exist, an amber
  "▲ N issues — F2" appears top-right. Click it or press F2 to open the full report.
  Clean database shows a quiet "ok".
- Per-row ⚠ markers: any entry doctor is worried about (messy name/fields, suspected
  duplicate) carries a small amber ⚠ in every list and live-search result — you can
  see problem entries in context instead of hunting for them.
## Theme (Campbell, prettier)
- Slim terminal titlebar (#111314, hairline border): INVENTORY · totals on the left,
  warnings on the right. Home screen no longer repeats the title.
- Column coloring in rows: BIN in bright white (the payoff info), C-IDs in Campbell
  cyan (#61D6D6), qty/value dimmed, name in body gray. Low-stock rows stay all-amber.
- Shelf digits on the home index in cyan. Selection bar inverts child spans correctly.

---

# v5.7 — browse-everything, linked dup markers, titlebar refinement
- `l` (or `list`) prints the FULL overview: every entry grouped under its shelf header.
- Universal browse: after ANY listing (l, shelf, bin, search results, low), ↓ starts a
  selection bar; w/s steer once active; ↵ info · ctrl+↵ take 1 · shift+↵ stock 1.
- Duplicate linking: =1 =1 marks a same-name group (doctor apply merges);
  ~2 ~2 marks a possible pair (manual `merge`); plain ⚠ = messy fields/name.
- Titlebar: INVENTORY · "12 items · 631 pcs" left; small amber "3 issues" pill right
  (click = doctor, F2 works silently). Clean db shows nothing. "— F2" text removed.

---

# v6.0 — PHASE 1: whole-shop taxonomy (two-level Dewey)
- 10 departments (hundreds digit) for the full maker shop: 0 GENERAL, 1 ELECTRICAL,
  2 FASTENERS/FITTINGS, 3 METALWORKING, 4 WOODWORKING, 5 3D PRINTING, 6 RESIN/CASTING,
  7 LEATHER/TEXTILE, 8 PAINT/FINISH/ADHESIVES, 9 TOOLS/MACHINES.
- Named SECTIONS on the tens digit (up to 100 groups), 26 pre-named (11 RESISTORS …
  51 FILAMENT … 92 SOLDERING), all renamable: `class 51 = PLA`; depts: `class 3 = …`.
- Navigation: 1/100 dept · 15/150 section · 110 exact bin · `map` full tree (browsable,
  every node tappable/selectable). Dept listings group rows under cyan section headers.
- Cross-trade guesser: ~30 rules with dept+section targets (m3x12 -> bolts, pla ->
  filament, tig -> welding, oak dowel -> dowels…). 21-case test suite passes; fixed
  "cap screw"≠capacitor, nuts-before-bolts, dowels-before-lumber orderings.
- `add` now files into the right SECTION's bin range (e.g. new resistor -> 11x).
- `remap 15 35` renumbers a dept/section/bin prefix wholesale (snapshot-undoable).
- Search haystack includes section names ("filament" finds everything in 51x).
- Storage key -> compinv-v6 (bin digits changed meaning); old data via export/import
  then remap. Seed re-homed: electronics under dept 1 sections, tools under 9.
- Git-safety note: the HTML contains no secrets; data lives in localStorage, not the
  file. Don't commit export dumps/backups if contents are private.

---

# v7.0 — 4-digit bins (DSBB) + PHASE 2 complete
## 4-digit bins — capacity fix
- Bins are now D S BB: dept · section · 2-digit bin -> 99 usable bins per section
  (xx01-xx99), ~10,000 total. "Only 10 resistors" ceiling removed.
- Navigation: 1 dept · 15 section · 1503 exact bin. Typing an EMPTY bin number now
  says so and offers `add <name> @<bin>`. All displays zero-pad to 4 (BIN 1101).
- Auto-assign starts at xx01 in the guessed section; if a section is somehow full
  (99 kinds) it overflows with an amber warning instead of silently mis-shelving.
- remap accepts up to 4-digit prefixes. Storage key -> compinv-v7 (fresh seed:
  resistors 1101/1102, caps 1201/1202, boards 1601/1602, tools 9101/9201, etc).
- Verified: 99 sequential resistor adds all land in 11xx with no collisions.

## Phase 2 — batch ops + activity log v2
- `take 1101 5` / `stock 1101 20` work directly on a bin holding one thing.
- `del 1501` (or `del bin 1501`) empties a whole multi-entry bin: lists contents,
  y/n confirm, snapshot-undoable.
- `low 1` / `low 15` scope low-stock to a dept or section.
- Log v2: every entry now records the item's cid. `recent take`, `recent today`,
  `recent <name>`, `recent export` (CSV, clipboard). Info cards show that part's
  last 4 events inline — per-item history at a glance.

---

# v8.0 — PHASE 3: Projects / BOM (blueprint.am-inspired)
- `proj new drone` creates a project and makes it ACTIVE (shown in the titlebar, cyan).
- Two ways to build a BOM:
  * command: `proj add drone 2x esp32` (also `esp32 x2`), `proj rm drone esp32`
  * pick-mode: select ANY row (live results, l overview, shelf, bin, low) and press
    `p` — +1 of that part into the active project without leaving what you're doing.
- `proj <name>` = readiness report: each line shows need / have / BIN / ok|short N,
  overall % ready, shortages in amber. Rows tappable/selectable like everything else.
- `proj shop drone` = shopping list (short qty + name + part number).
- `build drone` takes every BOM line from stock in one shot (refuses with a shortage
  list if parts are missing; `build drone partial` takes what's there). ONE undo
  returns every piece. Status auto-flips to [building]; `proj done drone` finishes.
- `proj` lists all projects with status + readiness %; `proj use <name>` switches
  the active target for the p key. All BOM edits are undoable (per-line for p-key,
  snapshots for commands).
- Data: state.projects [{pid,name,status,bom:[{cid,need}],created}] — additive,
  same storage key, existing data untouched.
- Phase 4 (brain graph) will render these BOM links as the live node graph.

---

# v9.0 — PHASE 4: brain graph + printable pick lists
## Brain graph (Obsidian-style, zero dependencies)
- `graph` = SPLIT view (terminal left, graph right — click a node, details print in
  the terminal). `graph full` = full-screen. esc steps full -> split -> off.
- Force-directed physics, ~180 lines vanilla canvas: pairwise repulsion, spring
  edges (rest length by node type), center gravity, velocity damping, alpha cooling
  that RE-HEATS on data changes — every save re-syncs, so pressing p on a part makes
  its node snap in and the springs visibly settle (live growth).
- Node types: projects (white, active brighter), departments (cyan-ring hubs),
  sections (gray), parts (green; amber when low). Edges: proj—part cyan (width by
  need), part—section—dept gray.
- Radio-Garden-style condensing: drag pans, wheel zooms (0.25x-6x), and labels
  reveal progressively — depts/projects always, sections past 0.75x, part names past
  1.5x or on hover. Hover dims everything but the node's neighborhood.
- Touch: one-finger pan / node drag, tap = open. Click routing: part -> info card,
  project -> readiness report, section/dept -> listing (in the terminal pane).
- With no projects yet the graph still shows the dept/section inventory skeleton.
## Printable pick list
- `proj print <name>` (also hinted after `build`): print-CSS page — checkbox, qty,
  part+value, BIG bin number, have-count; sorted by bin so it is one pass through
  the shop. White paper styling; the app hides itself during print.

---

# v9.1 — three graph views
- `graph inv` — EVERY part in the inventory as a node, hanging off its section ->
  dept hubs. Low stock amber. The Radio-Garden zoom applies: part labels at 1.5x+.
- `graph projects` — ONLY project nodes; edges between projects that share parts
  (edge weight = shared count). Click/tap a project -> drills into it AND prints its
  readiness report in the terminal.
- `graph <name>` — one project + only its added parts (need count in the label,
  amber when have < need). No class/section skeleton in project views at all.
- esc order: single project -> projects view -> full -> split -> off.
- `project new <name>` documented as the full-word form (multi-word names fine);
  added `create project <name>` alias. `graph full` keeps whatever view is active.
- View label top-left of the pane says which graph you're in.

---

# v9.2 — PHASE 5: labels, QR, camera scan
## QR encoder written from scratch (no library, stays single-file)
- Version 1 / EC-M / mask 0, byte mode, payload <= 14 bytes — exactly enough for
  "INV:1101". ~60 lines: GF(256) tables, Reed-Solomon (10 ECC codewords), finder +
  timing patterns, format bits, zigzag placement with mask 0.
- VERIFIED, not assumed: rendered to PNG and decoded with zbar (independent decoder).
  Two real bugs were caught this way — format bits were being written LSB-first
  (needed MSB-first from 0x5412) and the second format copy started one column late.
  Final check: INV:1101 / 9201 / 0042 / 3315 / 2104 / 5103 all decode correctly.
## Labels
- `labels` (all bins) · `labels 1` (dept) · `labels 15` (section) · `label 1101` (one).
- 62x29 mm cells (Brother QL standard) laid out in a print stylesheet: QR on the left,
  huge bin number, section name, contents line. Any printer works; a label printer's
  own driver fits them to its media. No printer bought yet — sizes are one CSS edit.
## Camera scan
- `scan` opens a full-screen camera overlay and uses the BarcodeDetector API
  (Chrome/Edge/Android). Scanning a bin's QR jumps straight to that bin; esc cancels.
- Honest limits: BarcodeDetector isn't in Safari/Firefox, and getUserMedia needs
  https or localhost (a file:// page can print labels but not open the camera).
  Kiosk/Pi served over localhost is fine.

# v9.3 — two-monitor mode
- `graph pop` opens the graph in its OWN browser window; drag it to monitor 2 and
  press F11. The terminal window drops back to full-screen on monitor 1.
- Design: the popup is a BLANK window (about:blank) whose canvas is drawn by the
  parent — there is only ONE app instance. No second copy, no storage/BroadcastChannel
  sync, so it works from file:// where cross-window storage is blocked.
- The animation loop schedules itself on whichever window is displaying the graph,
  so a minimised terminal window doesn't throttle the second screen.
- Clicking a node in the graph window prints its details in the terminal window.
  Esc in the graph window docks it; a watchdog also re-docks if it's closed manually.
- `graph dock` returns to split view. Parent unload closes the popup.

---

# v9.4 — pop/dock fix + minimal titlebar
## Bug: graph went dead after popping out and docking back
- Root cause: `gRAF` still held the animation-frame ID handed out by the POPUP window.
  After the popup closed that frame could never fire, but `setGraph`'s `if (!gRAF)`
  guard read it as "a loop is already running" and never started one in the parent —
  so the pane reappeared frozen (no physics, no hover, stale hit-testing).
- Fix: `dockGraph()` now clears `gRAF=null` unconditionally (a popup's pending frame
  dies with its window), resets pointer state via `gResetPointer()` (a drag or pan
  interrupted by the close used to leave the canvas stuck in panning mode with a
  grabbing cursor), and routes through `setGraph()` so exactly one loop restarts.
- `popGraph()` likewise forces a fresh frame instead of trusting a possibly-stale id,
  and `graph off` while popped docks straight to off instead of bouncing via split.
- Verified with a 13-step lifecycle simulation (split -> pop -> dock -> re-pop ->
  manual close -> off -> reopen -> pop-from-off -> dock): every state schedules its
  next frame on the correct window, none freeze. Harness stubs the DOM and asserts
  which window each frame lands on.
## Titlebar stripped
- Left is now just INVENTORY. The grey "N items · N pcs" sub-text is gone.
- Right shows only what's actionable: the active project name (cyan, tells you where
  the p key files parts) and the amber issues pill when doctor finds something.
  Nothing renders there when the database is clean and no project is active.
- Totals moved back onto the home screen as a dim line — content rather than
  permanent chrome — and `stats` still gives the full breakdown.

---

# v10.0 — PHASE 6: installable PWA + auto-backup, UI streamline
## Installable
- Deploy folder (index.html + sw.js + manifest.webmanifest + two PNG icons + README).
  Service worker caches everything on first load -> works fully offline afterwards.
- `install` command + an "install" pill in the title bar when the browser offers it.
  Falls back to explaining the browser-menu route, or that https is required.
- SW registration is guarded by protocol, so the SAME html still runs fine from
  file:// (no console errors, just no install/offline-cache).
- Hosting on GitHub Pages also fixes the Phase 5 caveat: camera `scan` needs https,
  so hosting turns scanning on as a side effect. localhost counts as secure too.
- Icons generated with PIL: 3x3 bin grid, centre bin cyan (192 + 512, maskable).
## Auto-backup
- `backup` opens a save-file picker ONCE; the handle is kept in IndexedDB (file
  handles can't be stored in localStorage) and the file rewrites itself every 5
  saves. `backup now` writes immediately, `backup off` forgets the file.
- Where the File System Access API is missing (Firefox/Safari), `backup` cleanly
  degrades to a timestamped JSON download.
- Permission is re-checked on boot; if the browser dropped it the app says so once.
  A "backup" pill appears only if the last backup is >7 days old and auto-backup is
  off — otherwise the title bar stays empty.
## BUG FIX — whole-bin delete hung
- `del 1501` set mode "confirmbin" but no Enter handler existed for it (added in the
  Phase 2 patch, never exercised). The prompt sat there and y did nothing; only esc
  escaped. Handler added: y empties the bin via a snapshot (one undo restores all).
## UI streamline
- Prompt is now a single cyan chevron. Hint lines cut to the bone:
  "type to search · ↓ browse" on home, "+3 more · ↵ info · ^↵ take · ⇧↵ stock · p
  project" under live results, "112 entries · ↓ browse" after listings,
  "drag · zoom · click" on the graph pane, "F11 for full screen" in the popped window.
- Title bar chrome softened (#0e0e0e, thinner rule, 11px) and only ever shows
  actionable things: active project, install, backup, issues.

---

# v10.1 — unified navigation (three selection systems -> one cursor)
## The problem
Navigation had grown THREE separate selection systems — home shelves (homeSel + w/s),
live search results (liveSel), and printed-list browse (browseSel + w/s) — each with
its own guards (homeActive / canHomeNav / canBrowse) and slightly different key rules.
The user had to track "which mode am I in," which was the navigation friction.
## The fix — one cursor, one rule
- New tiny layer: navRows() returns whatever selectable rows are on screen (live
  results if present, else any .idx rows — shelves, list rows, project rows, all the
  same). navMove(±1) / navPaint(i) / navSel() / navOpen(mod) drive a single cursor.
- ONE rule everywhere: Tab or ↓ = down, Shift+Tab or ↑ = up, Enter = open,
  ^↵ take / ⇧↵ stock / p add — all on the selected row. Esc drops the cursor.
- Deleted: homeActive, homeSel, browseSel machinery, paintHomeSel, paintBrowseSel,
  and the w/s special-casing entirely. ArrowUp still recalls history when the cursor
  isn't in a list (empty prompt) — shell habit preserved.
- Hints unified to one phrasing: "tab ↓ browse" everywhere; help "keys" section
  rewritten to the single model (was 11 lines, now 7).
## Verified
DOM-simulated behavioral test: the same keystrokes select and open correctly across
home shelves, printed lists, and live results; cursor clamps at ends and returns to
-1 (typing) above the top. 8/9 assertions pass (the 1 "fail" is a test-string typo,
not code — take correctly emits "take C-202 1").

---

# v10.2 — focused drill-in (clear screen on entering a shelf/section/bin)
- Opening a department (1), section (15), or bin (1503) now CLEARS the screen and
  shows only that view, via new focusHeader(): wipes out+live, resets the cursor,
  prints a breadcrumb ("2100  FASTENERS / BOLTS") and a dim "esc back · type to
  search" line, then the rows. Scrolls to top, not bottom.
- esc from a focused view already falls through to home() (cursor is dropped first if
  active — natural two-step: esc clears the cursor, esc again goes home).
- The overviews (l / list / bins / low) also clear first now, so the screen never
  accumulates — but they get "esc home" instead of "esc back" since they aren't a
  drill-in. `list 15` now routes to the section view too.
- Empty shelf/section shows a friendly "add something" line instead of "(nothing)".
- Verified focusHeader clears out, resets browseSel, and prints breadcrumb+hint.

---

# v10.3 — interactive command menu (minimal typing)
- New browsable command palette that behaves exactly like a section list: press `/`
  (or F1, or type `help`/`menu`) and every command appears as a selectable row —
  cyan command name + dim description. Same unified cursor: ↓/tab to move, ↵ to pick.
- Picking routes two ways:
  * no-argument commands (map, low, stats, graph, tidy, doctor, scan, undo, export…)
    RUN immediately.
  * commands that need input (add, take, stock, move, edit, del, info, labels,
    project, build, class) PRE-FILL the prompt (e.g. "take ") on a clean screen, so
    you just type the argument. Minimal typing, nothing to memorize.
- Live filter: `/lab` narrows the menu to matching commands (matches name AND
  description — "/dup" finds doctor via "find duplicates"). Typing past a `/` prefix
  re-filters; deleting it drops back to normal search.
- `help` / `?` / `menu` all open it; the old text wall is gone. Keyboard shortcuts
  moved to their own `keys` screen (also reachable from the menu).
- Verified: catalog covers all real verbs, every row is run-or-fill, filtering and
  run-vs-fill routing all correct (8/9 asserts; the 1 "miss" was a too-strict test —
  "lab" correctly also matches scan's "...bin label").

---

# v10.4 — ghost text (self-erasing command examples)
- A dim ghost layer sits behind the caret. As you type a command, it shows the
  UN-TYPED remainder of a matching example, erasing character-by-character behind
  the cursor: "add" -> ghost " 10k resistor x50 @1101"; "add 10k" -> " resistor
  x50 @1101"; "take res" -> "istor 5". Teaches the syntax without a manual.
- Templates per command (GHOSTS map): add/take/stock/move/edit/del/info/find/labels/
  project/build/class/merge/remap. Vanishes when the line is fully typed, doesn't
  match, or starts with "/" (menu).
- Offset uses `Nch` (monospace) so the ghost aligns exactly after what you've typed.
- Picking a fill-command from the menu (e.g. "add ") already calls drawMirror, so the
  ghost appears the instant you pick it — pick add, see the whole example, type over it.
- Empty prompt shows a faint "type to search, or / for commands" past the blinking
  block cursor.
- Verified in isolation: 6/6 states render the correct remainder at the right offset.

---

# v10.5 — selectable menu footer on focused views
- Shelf, section, and bin views now end with a selectable row:
  "… more commands (menu)". It's a normal .idx row carrying dataset.menu="run:menu",
  so the unified cursor reaches it — arrow to the bottom, Enter opens the command
  palette. No retyping to get from browsing a shelf to running a command.
- Reuses the existing menuFooter()/navOpen menu plumbing; verified nav-reachable and
  wired to open the menu.

---

# v10.6 — COMMANDS entry in the home index (a "help department")
- The home screen now lists a COMMANDS row right below the ten numbered departments,
  in the SAME hierarchy — a selectable button (dataset.menu="run:menu"). Arrow down
  past shelf 9, land on it, press Enter -> the command palette opens. Tappable too.
- Replaced the earlier per-view menu footer (v10.5) with this single home-index button
  per the user's clarification: they wanted a section-style button, not a pinned
  footer. menuFooter() removed; focused views are clean again.
- Number slot shows a dim "·" (not a fake 0000) so it reads as intentional, not an
  empty shelf; label "COMMANDS / press ↵ · full list".

---

# v10.7 — Arch Linux kiosk / autostart kit
- New kiosk/ folder: install.sh + README-kiosk.md.
- install.sh: pacman-installs chromium+python if missing, copies the deploy files to
  ~/invos (or a chosen dir), runs a python http.server as a USER systemd service bound
  to 127.0.0.1:8137 (localhost = secure origin, so camera scan + PWA install work),
  and writes ~/.local/bin/invos-kiosk that waits for the server then launches Chromium
  with --kiosk --kiosk-printing --app=... (silent one-tap label printing).
- README covers all four autostart routes: Hyprland/Sway exec-once, X11 .xinitrc,
  DE autostart .desktop, and a full headless agetty-autologin + startx kiosk. Plus
  loginctl enable-linger, CUPS printer setup, nightly cron backup, and app updates.
- Verified in-container: the local server serves index.html (200, 102KB) and the
  generated launcher passes bash -n with correct port/$HOME interpolation.
- Note reiterated: Chromium required for scan (BarcodeDetector); Firefox runs
  everything else. App holds no secrets; use the in-app `backup` for data.

---

# v11.0 — 3D holographic graph + update workflow
## 3D graph (zero dependencies — no Three.js, works offline on the kiosk)
- Can't load a CDN on a file://kiosk, so 3D is a hand-written projection onto the
  existing canvas: nodes gained a z coord + z-axis force physics; project() applies
  yaw/pitch rotation + perspective; renderer depth-sorts edges and nodes back-to-front.
- Toggle: `graph 3d` / `graph 2d` (or the 3D button in the pane). 2D path untouched.
- Two looks, `graph style` toggles: "holo" (cyan bloom via shadowBlur, bright node
  cores — the Jarvis feel) and "clean" (flat, matches the terminal). ✦ button too.
- Camera: auto-drifts (slow yaw); dragging empty space orbits (yaw+pitch) and stops
  the drift; wheel zooms; dragging a node still repositions it. Touch: one-finger
  orbit / node drag / tap-to-open. Verified projection math: depth order, perspective
  shrink, on-screen bounds, rotation all correct.
- Picking is 3D-aware (screen-space hit test, front-most wins), so click-to-open and
  hover-highlight work the same in 3D.
## Auto-home
- `graph home` (aliases reset/center/recenter), an `h` keybind while the graph is
  focused, and a ⌂ home button in the pane — all recenter camera + zoom + reset the
  drift. Menu gains a "graph 3d" entry.
## Update workflow (answering "can we push from here")
- No — the chat sandbox has no network path to the shop box. The loop is: the dev machine
  builds -> you commit/download -> the box pulls. kiosk/update.sh makes the box side
  one command: `./update.sh` (git pull) or `./update.sh new.html` (drop-in), then it
  bumps the service-worker cache version and restarts the local server. README
  documents the git-repo "forever station" setup.

---

# v11.1 — Escape keeps the graph; clears the terminal first
- Esc used to collapse the graph before clearing the terminal. Reordered so Esc peels
  layers in this priority: scan overlay -> open prompt/wizard -> typed text -> row
  cursor -> (full graph -> split) -> CLEAR TERMINAL TO HOME (graph stays!) -> step a
  single-project graph back to projects -> finally close the split graph.
- New isHome()/atHome flag: home() sets it true; focusHeader() and run() set it false
  so Esc knows whether the terminal still has content to clear before touching the
  graph. Result: with the graph open in split, Esc returns you to the sections/home
  screen with the graph still running beside it; only an Esc from an already-clean
  home closes the graph.
- Simulated the ladder across split+cursor, at-home, and full-3D-project scenarios —
  ordering is intuitive with no dead states.

---

# v11.2 — F3 for 3D graph + theme system
## F3 keybind
- F3 opens the 3D graph directly (graph 3d). Joins F1 (menu), F2 (doctor).
## Themes (6, interchangeable, persisted)
- The whole UI keys off 6 CSS vars (bg/fg/dim/amber/white/cyan + mono font), so a
  theme is just a value set. applyTheme() writes them as inline custom props on
  <html>, overriding :root instantly; also updates the PWA theme-color meta.
- Themes: campbell (Windows cmd default), phosphor (green CRT), amber (amber CRT),
  ice (cool blue), paper (light mode), synth (synthwave purple/pink).
- `theme` opens a browsable picker (● marks current, ↵ applies); `theme <name>` sets
  directly; `theme next` cycles. Choice saved in state, reapplied on boot.
- paper (light) auto-switches the 3D graph to the "clean" style since glow needs dark.
- Verified: all 6 themes complete, valid hex, fg≠bg. Preview strip in
  deploy/themes-preview.png.

---

# v11.3 — theme button + fixed click-to-select on menu rows
## How to change themes (now obvious)
- Titlebar has a persistent "◐ theme" button (and a "◈" 3D-graph button) — always
  visible, cyan, click opens the theme picker. Plus the existing typed routes:
  `theme` (picker), `theme <name>`, `theme next`, and F3 for the graph.
## Bug fixed: clicking menu rows did nothing
- rowTap (the click handler for on-screen rows) only handled dataset.cmd rows, not
  dataset.menu rows — so tapping the COMMANDS home button, any command-menu entry, or
  a theme in the picker was a no-op; only keyboard selection worked. Now rowTap routes
  menu rows too (run: executes, fill: pre-fills the prompt). Critical for the
  touchscreen kiosk where there's no keyboard.
- Verified: picker rows carry the run action, titlebar buttons wired, rowTap handles
  both row kinds.

---

# v11.4 — theme-aware graph + Jarvis visual upgrade
## Graph now follows the theme
- The graph was fully hardcoded (cyan/green) and ignored themes. Added themeCol()
  which reads the live CSS vars, and routed BOTH renderers (2D + 3D) through it, plus
  a hexA(hex,alpha) helper for translucent glow/fog. Change theme -> graph recolors
  instantly (synthwave = purple/pink nodes on violet, amber = gold hologram, etc.).
## Jarvis-tech upgrades (3D holo style)
- Depth fog: far nodes/edges fade, near ones pop — real sense of volume.
- Hub reticles: departments and the active project get concentric glowing rings
  (targeting-computer feel).
- Gradient edges: bright at the hub end, fading toward the leaf.
- Bright white node cores inside the colored glow (energy-source look).
- Ambient dust field: 40 faint drifting motes for atmosphere (holo only).
- All effects respect the theme's cyan/white/amber; "clean" style stays flat; light
  themes (paper) auto-use clean since glow needs dark.
- Verified: hexA correct for 6/3-digit/no-hash hex; mockup rendered in 3 themes
  (deploy/graph3d-preview.png).

## Further UI ideas on the table (not yet built)
- Scanline/CRT curvature shader overlay toggle · node pulse on recent activity ·
  edge "data flow" animation (dots travelling proj->part) · boot-up sweep animation ·
  low-stock nodes gently pulsing amber · a HUD frame around the graph pane.

---

# v11.5 — HUD frame + boot sweep (real, from the mockups)
## HUD frame
- CSS/SVG overlay on the graph pane (crisp at any size, theme-colored, ~zero cost):
  four glowing corner brackets, a top strip (INV.OS · context · "2D/3D · N NODES ·
  N DEPT" live stat), and a bottom status line (● LIVE · controls hint).
- On by default; toggle with the HUD pane button or `graph hud`; preference persists.
  With HUD off it falls back to just the small controls hint bottom-right.
- Context string tracks the view (INVENTORY / PROJECTS / PROJECT); stat refreshes
  a few times a second from live node/dept counts.
## Boot sweep
- Radar sweep drawn on the canvas for ~1.1s whenever the graph opens (setGraph kicks
  sweepT): a bright leading edge + fading wedge doing one full rotation from top.
  Holo-style only; `graph sweep` replays it. Purely an open animation, no perf cost
  after it finishes (guarded by time window).
- Verified: sweep guards on holo+time, full 2PI rotation; HUD toggles via body class,
  context strings per view, persistence wired.

## Next per your ranking: cycle-count / audit mode.

---

# v11.6 — HUD layout fix + cross-pane highlight
## Layout fixes
- Buttons rehomed: were at top-right colliding with the HUD top strip and (bottom)
  with #glabel. Now tucked inside the frame margin (top:11px right:24px) with the top
  strip clearing to right:150px; stat moved to its own line under the title so nothing
  overlaps. With HUD off, buttons return to the plain top-right corner.
- Redundant grey #glabel hidden whenever HUD is on (the HUD top strip already names
  the view — INVENTORY / PROJECTS / PROJECT).
- Relabeled: "● LIVE" -> "● live", hint reads "drag · zoom · h recenter".
## Cross-pane highlight (terminal <-> graph)
- graphHighlightCid(cid): finds the graph node "c"+cid and sets gHover, so it glows
  with the same halo/ring as a direct hover.
- Wired two ways: hovering a component row in the terminal (mousemove on out/live)
  lights its node; and arrow-key selection (navPaint) mirrors into the graph too.
  mouseleave clears it. Graph's own canvas hover is guarded to e.target===canvas so
  the two don't fight.
- Works in section drill-ins, the "more" lists, live search results — anywhere a row
  carries data-cid. Verified: node ids match c+cid, bridge + hover + nav all wired.

---

# v11.7 — HUD button spacing + node-core toggle
- HUD buttons dropped from top:11px/right:24px (nearly touching the corner brackets)
  to top:34px/right:16px — now sit clearly below the brackets with edge breathing room.
  Header lowered top:14->20px and reclaims full width (buttons are below it now, not
  beside it), so the "INV.OS // NODE GRAPH // INVENTORY" line has room again.
- Node cores toggle: the white centers in graph nodes are now switchable. New gCores
  flag (default on), gated in both the 3D holo and 2D renderers. Toggle lives on the
  theme screen as "[x] node cores" (click or select to flip); persists across sessions.
  `theme cores` also toggles from the prompt.

---

# v11.8 — button alignment + opening zoom
- HUD buttons moved to top:18px (was 34px) so their tops line up with the header text
  baseline on the left; header re-clears to right:150px so title/stat don't slide under
  them.
- Graph opens at gScale 1.35 (was 1.0) — slightly zoomed in so nodes are bigger and
  brighter and labels are visible immediately on open. graphHome() resets to the same
  1.35 so "h"/⌂ returns to the good default.

---

# v11.9 — zoom 1.45x + capitalized graph footer
- Opening/home zoom bumped 1.35 -> 1.45.
- Graph footer text capitalized: "● LIVE  DRAG · ZOOM · H RECENTER".

---

# v11.10 — zoom 1.6 + footer spacing/wording
- Opening/home zoom 1.45 -> 1.6.
- Footer: "H RECENTER" -> "H TO CENTER"; added 32px left margin on #ghint so the grey
  hint sits further right of the blue "● LIVE".

---

# v11.11 — center the grey footer hint
- #hud-bot text-align:center so #ghint centers in the footer bar; #hud-live (● LIVE)
  pinned absolute-left so it stays anchored. Removed the earlier margin-left hack.

---

# v12.0 — settings screen (graph/display tunables)
- New `settings` (aliases config/set) screen: browsable rows with [-] value [+] steppers.
  Adjust with ←/→ on the selected row, or tap the steppers. "reset all to defaults" row.
- Tunables (persisted in state.cfg): launch zoom (default 1.8, the requested value),
  auto-orbit drift speed (0=off), glow strength (%), dust field (on/off), part-label
  zoom threshold. All wired live into the graph renderer; launch zoom applies on the
  next graph open and immediately if open.
- setCfg clamps to min/max and snaps to step with float-safe rounding (verified 7/7:
  clamping both ends, exact 1.6->1.7 stepping, dust 0/1, fine drift steps).
- Menu gains a "settings" entry. Replaces hand-tuning zoom in code — change it live now.

---

# v12.1 — Jarvis widget pass + fixes
## Buttons/widgets
- Unified .barbtn/.warnpill into one widget style: fixed 22px height, centered
  glyph+label with flex, rounded, subtle cyan gradient + glow on hover. All titlebar
  buttons now consistent and aligned (align-items:center).
- Added ⚙ settings and ? help buttons to the titlebar (join ◈ graph, ◐ theme).
  Existing pills relabeled with glyphs: ⤓ install, ⁂ backup, ▲ N (doctor). Click
  handler uses closest("[id]") so clicking the glyph or label both work.
## Fixes
- "ADHESIVES" was clipped: home truncated dept labels to 24 chars, cutting
  "PAINT / FINISH / ADHESIVES" to "...ADHESIV". Widened to 28/pad 30 — all ten
  department names (longest 26) now fit fully. COMMANDS row padding matched.
- COMMANDS home row: removed grey "press ↵ · full list" text; now just an inline
  cyan • bullet in the count slot, consistent with the department rows' rhythm.

---

# v12.2 — hide titlebar + typed settings
## Hide the titlebar
- `bar` toggles it (also `bar on`/`bar off`/`bar hide`/`bar show`); F4 keybind too.
  body.bar-off { display:none } on #bar. State persists (state.barOff), reapplied on boot.
## Typed settings
- `set <name> <value>` (also settings/config) adjusts any setting from the prompt:
  `set zoom 2`, `set glow 1.5`, `set dust off`, `set orbit 3`. Name resolves by exact
  key, key-prefix, or label substring (so "zoom", "orbit", "label" all work). Values
  parse as numbers or on/off/yes/no (mapped to max/min); clamped + step-snapped by
  setCfg; applies live to the graph. Bare `settings` still opens the stepper screen,
  whose header now advertises the typed syntax. Verified resolver: partial keys,
  label match (orbit->driftSpeed), on/off, and clamping (glow 50 -> 200%) all correct.

---

# v12.3 — COMMANDS + empty-dept dots aligned to count column
- The COMMANDS row bullet was cyan and sat in a mismatched column. Changed to the
  exact empty-department count-slot string ("14 spaces + ·", class "d"/dim grey) so
  it lines up with the dots shown on empty departments and reads as the same style.

# v12.4 — dot alignment fix
- Previous fix put the dot 14 spaces in (col 52), which lined up with nothing since
  populated departments' counts start at col 38. Changed BOTH the empty-department
  dot and the COMMANDS dot to a bare "·" at the start of the count column (col 38),
  so every count-column entry — kinds numbers and dots — shares one left edge.
  Verified with a rendered mockup.

# v12.5 — dot alignment (real cause) + header cleanup
- The actual bug: department label slot was "  "+label.padEnd(30) = 32 chars, but the
  COMMANDS slot was "  COMMANDS".padEnd(30) = only 30 chars. That 2-char shortfall
  pushed the COMMANDS dot 2 columns left of the empty-dept dots. Fixed COMMANDS to
  "  "+"COMMANDS".padEnd(30) so both slots are 32 — dots now share the column.
- Removed the redundant home header line ("type to search · ↓ browse") — the titlebar
  widgets + COMMANDS row already make it discoverable. (Section-view back hint kept.)

---

# v12.6 — "Sections:" header + SECTIONS sun node
- Home list now has a white "Sections:" header above the department rows.
- Inventory graph gains a central "SECTIONS" sun node: every department links to it,
  it's pinned at the origin every physics frame (never drifts), is the biggest node
  (r 18+), bright white with the concentric hub rings + permanent label. This gives
  the graph a true center so the radar sweep/rings emanate from a node instead of
  empty space. Clicking it runs "home". Only exists in the inventory view.
- Verified: sun added in inv view, depts edge to it, pinned at origin, biggest in
  nodeR, always labelled in 2D + 3D.

---

# v13.0 — DATA INTEGRITY FRAMEWORK (single-machine hosting)
No device sync needed (one host machine); the risk is losing the single copy, so the
framework protects the one copy and makes recovery automatic.

## Five layers
1. Checksummed versioned envelope: every save wraps state as
   {v:SCHEMA, ts, sum:FNV1a(data), data}. Corruption is DETECTABLE on load.
2. Redundant dual-write: primary store (localStorage/artifact) + IndexedDB mirror.
   save() also re-reads the primary and verifies the round-trip (catches quota fails,
   partial writes) — sets lastSaveOk.
3. Validated load with fallback chain: primary -> mirror -> newest verified snapshot
   -> seed. Nothing loads unverified; recovery is announced ("data recovered from …").
   Legacy bare-JSON (pre-integrity) is accepted once and re-wrapped on next save.
4. Rolling snapshots: last 10 verified states kept in IndexedDB; `rollback` reverts
   one good state back (itself undoable). `rollback` with no arg lists the states.
5. `health` (alias status): shows primary/mirror/snapshot/last-save/file-backup status
   with [OK]/[!!] flags; a "⚠ save" pill appears in the titlebar if a save ever fails.

## Verified
- checksum deterministic + 1-char sensitive; envelope round-trips; data tamper caught
  (checksum); truncated/garbage/null rejected (parse); exhaustive byte-flip test —
  every flip touching data or checksum is caught (the only "misses" are flips in the
  ts timestamp, where data stays intact and load correctly succeeds).
- Menu gains health + rollback; verbs registered; schema v7.

## Still open (future, if wanted): scheduled export reminder, import-merge reconcile.

---

# v13.1 — removed grey instructional subheaders
- Dropped the grey "how to use" lines under the white headers on: settings
  ("↓ select · ← → adjust…"), command menu ("↓ pick · ↵ run…"), themes ("↓ pick ·
  ↵ apply · esc back"), and keys ("esc back"). Cleaner — the white header sits above
  one blank line then the content. Controls are self-evident / on the keys screen.

---

# v13.2 — spacing before node-cores toggle
- Added an extra blank line between the theme list and the "[x] node cores" toggle row
  so the display option is visually separated from the palette choices.

---

# v13.3 — integrity: boot self-check + off-machine reminder; theme row spacing
- NOTE: the core integrity framework (checksum envelope, dual-write+verify, fallback
  chain, snapshots, health, rollback) was already shipped in v13.0. This extends it:
  * Boot self-check: on load, re-verifies the primary store and warns if running on a
    recovered copy; nudges to back up if no off-machine copy in >14 days.
  * Off-machine tracking: state.lastExport set by export, downloadBackup, and a
    successful file writeBackup; shown in `health` with an [OK]/[!!] age flag.
- Theme tab: added a gap between the blue "node cores" label and its grey description
  ("white centers in graph nodes") — label padEnd(14) + 2-space desc indent.

---

# v13.4 — totals moved into the Sections header
- The grey "N components · N pcs · N bins" footer moved from the bottom of the home
  list to inline, right of the white "Sections:" header. Standalone footer removed;
  the low-stock line (if any) stays.
- (Reaffirmed: data integrity framework was already built in v13.0 — checksum
  envelope, dual-write+verify, fallback chain, snapshots, health, rollback. Type
  'health' to see it.)

---

# v13.5 — full competitive audit + rewritten roadmap
- Ran a 2026 market audit (Sortly, inFlow, Zoho, Katana, MRPeasy, Craftybase, etc.).
  Verdict: INV.OS is effectively a local/offline/no-subscription take on the asset-
  tracking SaaS category (Sortly is the closest yardstick). Edges: keyboard speed,
  Dewey spatial bins, true ownership/offline, data-integrity spine, the graph. Gaps:
  photos, cycle-count, check-out, multi-user/attribution, suppliers/PO, scan-first,
  reporting depth.
- ROADMAP.md rewritten around the 7 gap-closing points (R1–R7) + bigger bets (R8
  multi-user, R9 label round-trip) + distribution. Build order set: R1 photos + R2
  cycle-count first (photos also power the click-node-shows-photo goal in the graph).

---

# v14.0 — R1 Photos + R2 Cycle-count (pro-tier features)
## R1 Photos (Fallout-terminal layout)
- `photo <id>` opens file picker (camera on mobile via capture); also drag-and-drop
  an image onto the window (targets selected/open item); `photo <id> rm` clears.
- Images downscaled to <=640px JPEG (~q0.72) on a canvas, stored in their OWN IndexedDB
  keys ("photo:<cid>") so the main state blob stays small + snapshot/checksum-friendly;
  item carries only a boolean `photo` flag.
- infoCard rewritten as an HTML card: HUD-bordered photo floats RIGHT (cyan corner
  brackets, subtle grayscale/contrast so it reads as terminal, not pasted), text flows
  left of it then full-width below — bibliography style. New fields shown: supplier,
  source (where to find), link (clickable). Clicking a part node in the graph opens
  this card (photo included).
## R2 Cycle-count / audit
- `count [dept|section]` guided walk (oldest-counted first, then by bin): shows bin +
  system qty; blank=confirm, number=correct, skip, stop.
- `count due` = items not counted in 30+ days (rotating schedule).
- `count report` = discrepancy history (expected → actual, variance flagged amber).
- Per-item last-counted timestamps (state.counted); discrepancy log (state.countlog,
  capped 500); corrections apply to qty + write to the activity log.
- Verified: photo storage/downscale/flag wiring; count decision logic 7/7
  (blank/match confirm, mismatch correct, skip, stop, negative/garbage rejected).

## FORKING lite vs pro (planned split — see below)

---

# v14.1 — R1/R2 audit fixes (manager review)
Found + fixed 5 issues before moving on:
1. Orphaned photos: delete / empty-bin / merge now delPhoto() the removed items'
   images so IndexedDB doesn't leak.
2. CSV data loss: export+import were missing supplier/source/link. toCSV now writes
   11 columns; importCSV detects layout (old 8-col, legacy 9-col w/ category, new
   11-col) and maps correctly. Verified full round-trip incl. comma/quote/unicode.
3. Link safety: bare domains ("digikey.com/x") upgraded to https://; javascript:/junk
   rejected; rel="noopener noreferrer". Verified 5/5.
4. Count undoability: corrections now log {type:"edit", before:{...c}} so a bad recount
   is reversible with `undo` (was null — unrecoverable).
5. Count low-warning: a correction that lands at/below min now prints a <LOW>/reorder
   warning inline.

---

# v14.2 — roadmap: R10 spreadsheet/mobility + R11 onboarding
- R10 added: (a) spreadsheet on-ramp — smart CSV/XLSX import wizard with fuzzy header
  mapping, messy-sheet handling, dry-run preview, XLSX (SheetJS), Google-Sheets paste,
  round-trip export, template download; (b) mobility — responsive layout, phone-as-
  scanner, quick count/take screens, offline-tolerant, camera-first add. R10a is
  standalone/no-backend and moved to #2 in the build order (closes the #1 real
  competitor gap — spreadsheets). R10b sequenced with R8.
- R11 added: onboarding & first-run — guided first-run paths, interactive tutorial,
  demo-vs-real separation, contextual hints, shop-setup wizard (name shop + rename
  depts/sections), plus deployment onboarding (installer polish, printable checklist,
  optional pre-imaged Pi, competitor-CSV migration, why-not-subscription one-pager).
- Build order updated: R1/R2 done -> R10a -> R11 -> R3/R4 -> R6 -> R7 -> R5 -> R8 -> R10b.

---

# v15.0 — R10(a): robust spreadsheet importer  (3 passes, manager-reviewed)
## Formats
- CSV / TSV / TXT: built-in parser, ZERO dependency. Handles quotes, escaped quotes,
  embedded newlines, CRLF, BOM, and auto-sniffs delimiter (comma / TAB / semicolon-EU).
- XLSX / XLS / XLSM / XLSB / ODS (OpenOffice) / legacy Excel: via SheetJS, LAZY-loaded
  from a local xlsx.full.min.js only when a binary file is imported (base app stays
  lean; fully offline — SW caches it). Verified end-to-end for all 5 formats.
- Google Sheets / Excel copy-paste: `import paste` → paste a range (tab-sep) → parsed.
## Intelligence
- Fuzzy header mapping: ~90 synonyms across 11 fields ("On Hand"→qty, "Location"→bin,
  "Vendor"→supplier, "Reorder Point"→min, "MPN"→part, etc.).
- Header auto-detection (numeric/synonym heuristic); no-header sheets fall back to
  column order (col0→name).
- Messy-real-world handling: blank rows dropped, trailing TOTAL/SUBTOTAL rows skipped,
  quantities de-junked ("1,200 pcs"→1200, "x50"→50), bins letter-stripped ("BIN-1103"
  →1103), missing bins auto-assigned via the keyword guesser on apply.
## Wizard UX
- `import` → file picker; `import paste` → paste path. Both open a preview screen:
  detected mapping (col → field with sample values) + a 3-item preview + counts.
- Correct mappings live: `map <col#> <field>`, `header on|off`, then `apply` (snapshot-
  undoable) or `cancel`. Names run through tidyName on apply.
- `template` downloads a blank correctly-columned CSV starter.
## Manager audit across passes
- P1 parser: 8/8 (EU/tab/quotes/newlines/BOM/CRLF).  P2 mapping: 10/10 (synonyms,
  abbrevs, detection, no-header, blank/total skip, junk-qty).  P3 pipeline: 8/8 end-to-
  end + 5/5 binary formats. Old importCSV() now orphaned (kept; shares CSV helpers).

---

# v15.1 — FULL BUILD AUDIT (bugs / conflicts / security)
## Fixed
- Autocomplete gap (reported): tab-completion MAIN list was missing 16 real commands
  (bins, project, count, photo, template, health, rollback, theme, settings, bar,
  keys, menu, status…). Rebuilt the list — now covers every user command.
- Count color bug: corrected line used actual<=c.min?"a":"a" (both amber). Fixed to
  green when not low, amber when low.
- Import row cap: added a 5000-row guard so a runaway sheet can't freeze the browser
  or blow past storage quota.
- esc() hardened: now escapes quotes (\" and \x27) in addition to & < >, so any future
  user-data-in-attribute path is safe (defense-in-depth).
## Audited clean (no action needed)
- XSS: every innerHTML path that includes user data is esc()'d (print, infoCard/row,
  both print sheets, label sheet, titlebar project name, glabel). Verified each.
- URL safety: link field goes through safeUrl() (only http(s)/bare-domain; rejects
  javascript:/data:/vbscript:/junk) AND esc(). img src is a self-generated data: URL.
- No duplicate case labels (multi-label cases are intentional).
- Undo coverage: all 13 logged undo types have a handler.
- SheetJS lazy-load injects only hardcoded local script paths (not attacker-controlled).
- Count corrections snapshot before-state (undoable); count captures before qty change.
## Minor notes (not bugs)
- reset confirm re-defaults theme/cfg/counted on next load (cosmetic; data-wipe is
  intended). photoCache unbounded but photos are small/few. drag-drop photo falls back
  to last-viewed card. All acceptable.

---

# v16.0 — DATABASE POC: local-first storage adapter + optional Go/SQLite server
## Decision: single app, NOT a fork
- All persistence funnels through save()/load() + the `store` object (verified: 1 def
  each). So a server backend slots in behind `store` with ZERO changes to the 44
  save-calls, the integrity layer, or the UI. No fork — one codebase, two runtimes.
## Local-first guarantee (unchanged owned app)
- With no server configured the app is byte-for-byte the same: localStorage + IndexedDB
  + integrity, fully offline, you-own-it. The server is OPT-IN.
- store gains a SERVER target active only when invos-server-url is set: reads prefer
  server (fall back to local on any failure), writes go to BOTH, outages never throw.
## Proven, not assumed
- 14/14 POC assertions (mock server mimicking the Go API): no-server=pure local;
  server-up=two-way sync; server-down=silent local fallback, no throw; reconnect=resumes.
## Server (server/ — OPTIONAL, single Go binary + SQLite)
- main.go: /api/state (whole-state blob, GET/PUT, 50-deep history), /api/config
  (per-client sections/classes override — the "sections as GET requests" ask),
  /api/health; optional X-INVOS-Token; CORS; serves ./deploy too. Uses modernc.org/
  sqlite (pure Go, no cgo → true single binary). go.mod, README, Dockerfile,
  docker-compose all included. (Go toolchain unavailable in this sandbox to compile —
  code is std-lib + one well-known driver; build with `go build`.)
## App wiring
- `server <url> [token]` connects; `server off` returns to pure local; `server` shows
  status. health screen shows sync state. On boot with a server set, the app pulls
  /api/config and applies classes/sections overrides (client-by-client customization).
## Chosen: whole-state sync + Go + SQLite (one file per client = swap/customize per client).

---

# v17.0 — PHYSICAL SQLITE MIRROR (own your data as a real .db file)
## Model (user chose #2 + "most browsers")
- Browser storage stays PRIMARY (fast, every write instant). The app ALSO mirrors to a
  real invos.db SQLite file the user physically owns — via sql.js (SQLite-in-WASM,
  lazy-loaded, ~658KB wasm, cached by SW). Never blocks; if the file handle drops the
  app keeps running on browser storage and stops mirroring silently.
- Chromium/Edge: File System Access API auto-writes the chosen invos.db on save
  (batched every ~8 writes). Firefox/Safari (no FSA write): `db`/`db export` downloads
  a real .db on demand — graceful degradation, app never breaks.
## The .db is genuinely portable/openable (VERIFIED)
- File header = "SQLite format 3". Built with: meta, state(blob for exact restore),
  items (queryable: cid,id,name,dept,section,bin,qty,min,value,pkg,part,supplier,
  source,link,notes,low), sections tables.
- Proven from EXTERNAL Python sqlite3: SELECT low-stock, SUM(qty), section lookups,
  and state-blob restore all work. Opens in DB Browser / sqlite3 / Python / Excel-ODBC.
## Commands
- `db` attach a physical file (Chromium auto-syncs; else downloads) · `db export`
  download a snapshot now · `db now` force sync · `db off` stop. Status in `health`.
- Boot restores the file handle (re-grants permission if the browser kept it).
## Architecture note
- This is the third storage adapter behind the same seam: local (default) · optional
  server (Go/SQLite) · physical .db mirror. All local-first; app owns its data offline.
- SW cache -> invos-v3 (adds sql-wasm.js/.wasm). Base app stays lean (WASM lazy-loaded).

---

# v17.1 — server compiled/tested + titlebar buttons de-iconed
## Go server verification
- Installed Go 1.22 (apt) in-sandbox. main.go is valid, gofmt-clean Go.
- SQLite driver (modernc.org/sqlite) download blocked by sandbox allowlist
  (proxy.golang.org) — builds fine on any real machine: go build -o invos-server main.go.
- Proved the HTTP CONTRACT the app depends on via `go test` (server/contract_test.go,
  stdlib-only mirror using json.RawMessage exactly like main.go): the checksummed state
  blob round-trips BYTE-EXACT (unicode Ω intact → app checksum still validates), and
  per-client config/sections serve correctly. 2/2 pass.
- Design confirmed: server stores blob as TEXT and returns json.RawMessage (verbatim),
  never re-parsing — critical so the app's data checksum survives the round trip.
## UI
- Titlebar blue buttons: removed icons (◈ ◐ ⚙ ?), kept words (graph · theme · settings
  · help). Status warnpills keep their glyphs.

---

# v17.2 — R11 scope set + roadmap reorg (planning only, no code)
- Confirmed inventory tracking is COMPLETE: add/take/stock/move/edit/del + count
  (cycle-count/audit) + low + stats + recent + undo, all shipped & tested. Only
  tracking-adjacent gap is check-out custody (R3, intentionally later).
- R11 ACTIVE scope narrowed to the trio: guided first-run (3 doors), shop-setup
  wizard (name shop + rename depts/sections), demo-vs-real separation + backup nudge.
- Item 7 (competitor-CSV migration import) MOVED to R10 as its next task (belongs with
  the spreadsheet on-ramp / when we work Excel sheets).
- Items 4/5/6 (interactive tutorial, contextual hints, progress checklist) DEFERRED to
  a new "DEFERRED — onboarding polish" section at the end of the roadmap (R11.4/.5/.6).

---

# v18.0 — R11 onboarding trio + fully editable departments/sections
## First-run doors
- On first boot (flagged + not yet customized) the app shows a Welcome with 3 doors:
  import a spreadsheet (-> the R10 importer) · start fresh (-> setup wizard) ·
  explore the demo (loads seed, flags it). Picking any door clears the first-run flag.
- `welcome`/`firstrun` re-opens it anytime.
## Shop-setup wizard
- `setup` (alias `shop`): step 0 names the shop, then walks the 10 departments letting
  you rename each (blank skips, 'cancel' exits). On finish, applies name + renames,
  clears first-run. Shop name shows on the home screen and in the titlebar.
- Verified with a step-machine simulation: name + a dept renamed, others untouched,
  first-run cleared.
## Demo separation
- `demo` shows status; `demo clear` wipes seed data (y/n confirm) and starts real.
  Home shows a "── DEMO DATA ──" amber banner while demo data is loaded. reset confirm
  now re-flags demo + re-arms first-run for a clean slate.
## Editable departments/sections (as normal settings, per request)
- Rename dept: `class 3 = METALWORKING`. Rename section: `class 51 = PLA`.
- NEW delete/clear a section name: `class 51 clear` (also del/-/x/remove) — guarded:
  refuses if that section still holds items (asks you to move/remove them first).
- All changes are undoable (existing class/section undo types).
## Verified: 12/12 wiring checks + wizard sim + final syntax.

---

# v18.1 — section manager + migration importer
## Section manager (easier add/remove/edit)
- `sections` (alias `shelves`): browsable tree of all 10 depts + their sections.
  ↵/tap a dept row to rename it; ↵/tap a section row to rename; tap the inline "+"
  on a dept to ADD a section (pick digit + name); tap "-" on a section to clear it
  (guarded — refuses if it holds items). All still available by command too.
- New internal modes secedit/secadd; all changes undoable.
## Migration importer (R10 next task — DONE)
- Extended the import synonym map with the actual column headers Sortly / Zoho
  Inventory / inFlow / Square export (Entry Name, Stock On Hand, Folder, Min Level,
  Reorder Level, Vendor Name, Barcode, SKU, Current Quantity, etc.).
- Verified 4/4: Sortly, Zoho, inFlow, Square headers all auto-map correctly, so
  switching away from a competitor is a one-step import.
## New ideas captured in roadmap (R12/R13/R14)
- R12 Project Galaxy: 3D projects-as-galaxy-clusters, shared-part bridges, time-grow.
- R13 Project docs & gallery: downloadable project writeups + image galleries.
- R14 Discovery feed: offline idea seed + optional are.na/maker-feed pull, "catch the
  shooting star" playful suggestion capture, match-to-stock highlighting.

---

# v19.0 — ROADMAP v2 (restructured) + A1 Project Galaxy
## Roadmap
- New ROADMAP-v2.md (old ROADMAP.md preserved). Reordered by dependency/effort/impact
  into phases: A (galaxy, docs, reporting — standalone, next) · B (custody, operator,
  suppliers) · C (scanning, mobility) · D (multi-user, gated on server) · E (discovery).
## A1 — Project Galaxy (graph galaxy)
- New graph view: each project = a cluster core, its BOM parts orbit as stars; a part
  used by 2+ projects becomes ONE bright white "shared" star wired to each — forming
  bridges that show how projects interconnect. Best in 3D (auto-enables).
- `graph galaxy` (aliases universe/clusters) opens it; `graph grow` (timeline/play)
  animates the universe forming oldest->newest over ~6s using project.created.
- shared-star node type: bigger than parts, bright white, in nodeR + both 2D/3D
  renderers; low-stock parts still pulse amber. Click a cluster -> single-project view.
- HUD/label context updated for GALAXY. Menu gains "galaxy".
- Verified 7/7: 3 clusters, correct shared-part detection (ESP32+Jumpers bridge),
  unique parts stay local, bridges wire to the right projects, time-grow cutoff works.

---

# v19.1 — faster first-run + demo seeded (items + connected galaxy)
## First-run doors reworked
- 4 doors now: "just start" (empty + default sections, straight to home — no Enter-
  mashing), "set up my shop" (the optional wizard), "import a spreadsheet", "explore
  the demo".
- Setup wizard: type a name then 'done'/'skip' at any step to finish immediately
  (keeps whatever was entered). No more hitting Enter through all 10 departments.
## Demo seeded on fresh load (so you can view how it works immediately)
- First open now loads the DEMO: all seed items + 4 galaxy-connected demo projects
  (Weather Station, Robot Arm, Desk Clock, Line Follower) that deliberately SHARE
  parts -> 7 bridges in the galaxy (Jumpers x3, ESP32/OLED/Uno/HC-SR04/Breadboard/
  R220 x2). R10k seeded low (30<50) to show amber. DEMO banner + first-run doors still
  present; "just start" or 'demo clear' wipes it for real use.
- Verified 8/8: items seeded, 4 projects, demo flag, all shared-part bridges correct.
- To see it: open the app -> 'graph galaxy' (or graph grow to watch it form).

---

# v19.2 — demo galaxy viewable on demand
- Problem: demo only auto-seeds when browser storage is EMPTY, so a returning user (or
  a preview with prior data) saw no projects and 'graph galaxy' said "none".
- Fix: `demo` (also demo load/galaxy/show, or the menu "demo") now LOADS the demo on
  demand — if you already have real data it asks first (y/n) — then AUTO-OPENS the
  galaxy in 3D. The first-run "explore the demo" door does the same.
- Verified: seeded demo -> galaxy builds 14 nodes / 18 edges (4 projects, 7 shared
  stars). To view: open app, type `demo` (or pick it from the menu / first-run door),
  then optionally `graph grow`.

---

# v19.3 — graph view toggle (get back from galaxy!)
- Problem: once in the galaxy there was no clean way back to the inventory/sections
  graph. Added a view cycle: INVENTORY (sections & parts) -> PROJECTS -> GALAXY -> back.
- Three ways to switch: "◱ view" button in the graph pane · the `g` key (graph open,
  empty prompt) · `graph next` (also cycle/switch/toggle). `graph inv` still jumps
  straight to the sections view too.
- Edge cases handled (6/6): drilled-in single project counts as "projects"; with no
  projects the cycle just stays on inventory. Galaxy auto-enables 3D.
- keys help + button tooltip document it.

---

# v20.0 — galaxy/graph refinements
- Titlebar right side no longer shows the active project name ("Weather Station"
  persisting) — it's empty now; only actionable pills appear there.
- View switching shows a small fading center TOAST (INVENTORY / PROJECTS / GALAXY /
  <project>) via setGraphView, so every switch (button, g key, command, demo) announces
  what's showing and fades after ~1.1s. No scrollback spam.
- Projects view now has a central "PROJECTS" SUN node (pinned at origin) that every
  project orbits — instead of a random project appearing central. Shared-part links
  between projects still drawn.
- Galaxy: project nodes tagged core:true; physics boosts core-core repulsion ×14 in
  galaxy view so clusters spread apart with dark space between them (the "zoom out and
  it looks like a universe" goal). Parts still orbit their own cluster tightly.
- Verified 8/8 wiring + syntax.
NOTE (backburner, per user): a true super-zoomed-out universe with many clusters may
get CPU/GPU heavy; spatial-grid optimization noted for later if node counts grow.

---

# v20.1 — spread project nodes (projects + galaxy), sections graph untouched
- Project nodes were too close in the projects view. Now project nodes are tagged
  core:true in BOTH projects and galaxy views; core-core repulsion boost (×14) and a
  long project spring (rest 160 vs 70) apply in those two views only.
- INVENTORY/sections view physics are provably UNCHANGED (no core boost; dept 85 /
  part 55 springs as before). Verified 8/8 scoping checks.

---

# v20.2 — galaxy far-spread + orbiting parts + trails; no-galaxy fork
## Galaxy / projects view rework
- Core-core repulsion cranked ×60; project spring rest 520 -> project clusters sit so
  far apart you pan/scroll between them (the "zoom out = universe" feel).
- Projects view: each project is a cluster core orbiting the central PROJECTS sun, and
  THAT project's parts orbit ITS core (parts now visible in projects view).
- Inter-project links are faint DASHED "trails" (negative edge weight): negligible
  spring pull (0.002 vs 0.045) so they don't collapse the spacing, rendered dim+dashed
  in both 2D and 3D. Edge width uses abs(w) so trails don't break sizing.
- Sections/inventory graph physics still fully untouched.
- Verified 9/9 wiring + a build sim (23 nodes / 5 trails for the 4-project demo).
## No-galaxy fork
- fork-no-galaxy.html: a clean, working copy with the galaxy removed. Implemented as a
  single guard in setGraphView (galaxy -> projects) so every galaxy entry point is
  neutralized reliably, plus galaxy dropped from the view cycle and the menu, and a
  title marker. Everything else (inventory, projects graph, all newer features) intact.
- (Couldn't rewind to the literal pre-galaxy version — no saved snapshot existed — so
  this fork is derived from current code by removing galaxy, which is reliable/tested.)

---

# v21.0 — THE EXE (main branch): Go binary + real SQLite, HTML app forked to a demo

## Repo went to git; two tracks
- `html-demo` branch, tag `html-demo-v20.2` — the single-file HTML app, FROZEN as it
  shipped. It becomes the free public demo (strip-down pass is D1 in the roadmap).
- `main` — the product. One Go exe: embeds the UI, owns a real SQLite database, serves
  itself on the LAN so shop tablets and the office PC share one inventory. The same
  code becomes the SaaS build.
- main no longer carries deploy/ or the two root .html copies (they live on the demo
  branch), so the "keep three HTML files in sync" burden is gone. The exe's UI source
  is internal/web/ui/. The old whole-blob server moved to legacy-blob-server/.

## Architecture
- internal/store — the ONLY package that touches SQL. `Store` interface + SQLite impl.
  The SaaS Postgres backend implements the same interface; nothing above it changes.
- internal/api — JSON REST over the Store. Optional shared token for untrusted LANs.
- internal/web — go:embed of the UI, so the product is genuinely one file.
- cmd/invos — the binary. cmd/invos-stress — the measurement harness.

## The RAM fix (the reason for the rewrite)
The HTML app held the entire inventory in browser memory as one JSON blob and
re-serialized ALL of it on every single write. That is what breaks at volume. The exe
never loads the inventory: every read is a paginated query, every write is one
statement. Measured heap is FLAT — 0.4 MB at 10k items and 0.4 MB at 100k.

## Measured, not assumed (100,000 items, this laptop)
Three real problems showed up and were fixed against the numbers:

1. Home screen 68ms. Aggregating the item table for ten department counts, on the one
   screen the app returns to constantly. -> trigger-maintained `shelf_counts` table.
   **68ms -> 0.0ms**, and it no longer grows with inventory size.
2. Search 88ms per keystroke, and 814ms for a rare term (the part-number lookup — the
   single most important operation in a real shop). -> FTS5 with the **trigram**
   tokenizer, which indexes substrings, so "type any fragment anywhere" behavior is
   preserved exactly rather than downgraded to prefix matching.
   **common term 88ms -> 2ms · rare term 814ms -> 3ms**
3. Even with the index, search stayed slow. Profiling showed the index was never the
   cost: fetching 8 rows was already 0ms. The cost was the exact `COUNT(*)` and the
   global `ORDER BY`, both of which visit every match. Live search shows the top 8 and
   does not need either. -> `ItemQuery.Approx`, which stops at CountCap (200) and sorts
   within that. Explicit actions (full result list, reports) still get exact answers.

Final at 100k items: home 0.0ms · live search 2ms · 2-token search 11ms · rare term 3ms
· open a shelf 3ms · low-stock 2ms · write 0.5ms · process RSS 16.5 MB · db 78 MB.

Cost accepted for the trigram index: ~6x slower bulk seeding (100k in 32s) and ~2.4x
disk. Worth it — the 814ms -> 3ms rare-term lookup is the operation a shop lives on.

## SQLite stays; Postgres is not needed
100k items is already far past what a shop reaches, and everything is index-bound at
that size. Postgres enters only for SaaS multi-tenancy, which is exactly why the Store
interface exists from day one.

## Verified
20 Go tests, including: unicode-tolerant search (10kohm finds 10kΩ), mid-word fragment
matching, LIKE-wildcard escaping, qty clamping at zero, patch column/value pairing
(caught a REAL bug — sorting the SQL fragments without reordering their arguments wrote
values into the wrong columns), undo restoring a deleted item WITH its original CID,
trigger-maintained counters staying correct across add/stock/move/delete, bulk import
undoing as one step, and 200 concurrent takes with zero lost updates.

---

# v21.1 — P2: the UI actually talks to the database (and a real UI test harness)

## The gap this closed
v21.0 shipped an exe that served the UI *and* an API, but the UI ignored the API — it
still kept everything in browser localStorage. The server was a spectator. Now every
read is a bounded query and every write is an API call, so the database is genuinely
the system of record.

## UI test harness (new, and the reason this was safe to attempt)
`test/ui/smoke.mjs` — launches the real binary, drives the real terminal in headless
Chromium (playwright-core against the already-installed browser), and asserts on what
a person would see. 22 checks. Crucially it also reads the server directly afterwards,
so it proves the typing reached SQLite rather than only the screen:
add/take/undo arithmetic, move, delete->404, undo restoring the ORIGINAL C-ID, and the
activity log filling up. Run: `cd test/ui && node smoke.mjs` (`--headed` to watch).

The multi-device promise is now a test: two browser pages, one adds an item, the other
finds it with no sync step. That is the thing the HTML demo can never do.

## What changed in the UI
- `DB` — a small API client. `state.items` is no longer the inventory; it is only the
  rows currently ON SCREEN. `setView()` installs a page, `DB.viewComplete` says whether
  that window happens to hold everything.
- Ported to the server: home screen (dept counters), search, resolve, shelf/section/bin
  views, low, stats, list, map, labels, add (incl. the duplicate check), take/stock,
  move, delete, undo, activity log, next-free-bin, demo seeding (one bulk insert).
- `home()` deliberately stayed SYNCHRONOUS, painting from cached aggregates and
  refreshing behind that. Making it async raced a dozen callers that print or render
  immediately after it, including bare key handlers.
- `renderLive()` became async and got a sequence guard: live search now crosses the
  network per keystroke, so a slow reply for "wid" could otherwise repaint over the
  reply for "widget". It also asks for an approximate page (top 8 + capped total),
  which is what the CountCap work in v21.0 was for.
- `save()` no longer writes inventory anywhere — mutations already went to the database
  with their log entry in one transaction. It now persists only per-DEVICE preferences
  (theme, graph settings, HUD), which should NOT be shared between the shop's tablets.

## Refusals instead of silent data loss
Features whose data has not moved into the database yet are switched OFF with an
explanation rather than left to accept work that vanishes on reload: projects/BOM,
build/pick, cycle count, spreadsheet import, the browser-side .db mirror, the old
sync-server setting, rollback, file auto-backup. Commands that cannot be honest on a
partial window (doctor, tidy, remap, merge, CSV export) refuse via `needsAll()`.
This is deliberate: an inventory tool that quietly forgets is worse than one that says no.

## Still to do (roadmap P5-P7)
Projects/BOM writes need store+API support (reads already exist), then cycle count,
then wiring the importer to the bulk endpoint that already exists.

---

# v21.2 — P5: projects & BOM in the database (+ a nasty stale-cache bug)

## The service-worker bug (found by accident, would have been ugly in a shop)
The PWA service worker was cache-FIRST for every GET, including `/api/`. So the
second time the app asked for the same URL it got the first answer back — forever.
A bin could read 40 while the drawer held 4, and no amount of reloading would fix it.
It only surfaced because a project created seconds earlier did not appear in the list.

`/api/` is now network-only; the shell (HTML, icons, lazy libs) is still cached, so
the station still starts instantly. Cache bumped to invos-v4.

Guarded by a test that repeats ONE identical request across a change and demands the
second answer differ — the shape of bug that is invisible until it is expensive.

## Projects / BOM (P5)
- Store: Project/AddProject/UpdateProject/DeleteProject/SetActiveProject, SetBomLine,
  RemoveBomLine, SharedParts. Projects gained a `status` column.
- Undo handlers for all of it: proj.add/edit/del and bom.set/del. Deleting a project
  stashes its part list too, so undo restores the build AND its BOM, with the original
  pid so the lines still point at it.
- `SharedParts` finds items used by more than one project in SQL — that is what draws
  the bridges between clusters in the galaxy view, and it means the browser never has
  to pull every BOM to intersect them.
- API: full REST for projects and BOM lines, plus /api/shared-parts.
- BOM lines come back joined with the part's name, bin and live stock, so "need 4,
  have 2" needs no second query per line.
- List endpoints now return `[]` rather than `null` when empty.
- UI: `proj`, `build`, the `p` key and the project views are un-gated and wired to the
  API. Projects ARE loaded in full — unlike items — because a shop has tens of builds
  with a few lines each. That is bounded, and it keeps the graph/galaxy code working.

## First run is a shop fact, not a browser fact
`setup_done` lives in the database, so the second tablet to open the app does not get
the welcome screen again. The demo door now seeds items AND four connected projects
through the API, which is what gives the galaxy its shared-part bridges.

## Verified
- 26 Go store tests (6 new: project lifecycle, BOM tracking live stock, deleting an
  item clearing its BOM lines, undo of project delete restoring the BOM, undo of BOM
  changes, shared-part bridges).
- 33 UI end-to-end checks, now covering the first-run doors, the demo seed creating
  projects with shared parts, proj new/add/undo/del against the database, and the
  stale-cache guard.

---

# v21.3 — ORBIT MODE (from ORBIT-SPEC.md) + two bugs it exposed

## Orbit mode
`graph orbit` (aliases: orbits / planets / spin). In the galaxy and projects views the
force layout is allowed to settle, then every node stops being simulated and starts
revolving: parts around their project's core, projects around the central sun.

Orbits are circles on individually tilted 3D planes — through the existing perspective
camera they read as ellipses, which gives the planetary feel without the cost of real
Kepler ellipses. `initOrbits()` captures each node's CURRENT radius and angle, so
switching the mode on makes nothing jump; it just starts moving from where it stopped.
Each node's tilt and direction come from a stable per-node seed, so they persist.

While orbiting, `gAlpha` is pinned low and the frame returns before the force code —
the physics and the orbits must never run in the same frame or they fight each other.
Default OFF: it repaints continuously, so it is a show mode.
Tuning knobs are all in `initOrbits()` (master speed, tilt, minimum radius).

## Bug 1: the graph was drawing from the on-screen window
After the P2 port the inventory graph read `state.items`, which is now only the rows
currently displayed — so it drew almost nothing. The graph now does its OWN bounded
fetch (`GRAPH_ITEM_CAP` = 1500 parts) and the label says when it is showing a sample.
A force simulation over 100k nodes is neither drawable nor useful.

Worse, the galaxy's part-stars looked up each BOM part in `state.items` too, so every
star silently vanished. They now come from the BOM lines themselves, which arrive from
the API already joined with name, bin and live stock.

Also removed: `loadDemoData` still assigned the OLD hardcoded `state.projects` array
AFTER seeding the database, overwriting the real projects with stale line objects that
had no names. That is why every galaxy star came out unlabeled — and an unlabeled node
crashed `gDraw3D` outright, killing the render loop. The draw now tolerates a missing
label instead of throwing.

## Bug 2 (pre-existing, and a genuinely annoying one): g and h ate your keystrokes
With the graph open, the bare `g` and `h` hotkeys fired whenever the prompt was empty —
so the first letter of anything starting with g or h was swallowed. You could not type
"graph", "glue", "grinder", "help", "health" or "hinges". Typing `graph orbit` produced
`raph orbit`, which is how it was found.

This contradicts the app's own rule that typing is never punished (the same reasoning
that kept `w`/`s` out of the way back in v5.3). They are now `alt+g` / `alt+h` from the
prompt, and still bare when the graph pane itself has focus — which is where a
mouseless shortcut actually belongs. `keys` updated.

## Verified
39 UI end-to-end checks (6 new for orbit): the mode toggles, orbits are captured once
the layout settles, nodes measurably move, every orbiting node holds its radius from
its parent (which is what makes it an orbit and not drift), it toggles off again, and
the inventory view is left alone. The settle wait is a condition, not a sleep, so it
does not flake on a slower machine. Three consecutive clean runs.

---

# v22.0 — FULL PORT: every HTML feature now runs against the database

The exe had a working core but a set of features switched off with an explanation.
They are all on now, and all of them write to SQLite. Nothing is gated.

## Parity, checked rather than claimed
- command set: identical to the HTML build (diff of every `case "x"` — empty both ways)
- functions: identical (no function in the HTML that is missing here)
- menu entries: identical
- head/CSS/body markup: byte-identical
The one deliberate difference is the g/h hotkeys (see v21.3 — they made "graph" and
"help" untypeable), now alt+g / alt+h.

## Also picked up the newer HTML build the user re-added
It was ahead of the fork point: `export xlsx` / `export full` (multi-sheet workbook),
`export report` (printable/PDF summary), `export photos`, and `graph png`. All ported,
reading from the database rather than an in-memory array.

## What each gated feature became
- **cycle count** — `RecordCount` books the corrected quantity, the counted-at stamp and
  the discrepancy row in ONE transaction, undoable. Scope is a query, so counting a
  shelf walks that shelf whatever its size. `count report` reads the server's history.
  A count that MATCHES is still recorded: "we checked and it was right" is the evidence
  an audit trail exists to provide.
- **doctor / tidy / remap / export** — these are meaningless on a page of results, so
  they explicitly pull the whole inventory (`loadAll`, which pages through and says so
  for big shops). Their WRITES go through `BulkUpdate`: one transaction, one log entry,
  so renaming 400 items is ONE undo, not 400.
- **merge** — server-side: quantities add, blank fields fill from the duplicate, BOM
  lines repoint (a project referencing both keeps the larger need), duplicate removed.
  Undo restores the survivor's fields AND the duplicate with its original CID.
- **import** — the wizard is unchanged; the commit is one bulk insert, so a 5,000-row
  spreadsheet is one transaction and one undo step. Bins are handed out per department
  as the batch is built, so a run of similar parts does not all land in one bin.
- **photos** — moved from per-browser IndexedDB into the database. A photo taken on the
  phone at the bench is now there on the office PC. Blobs live in their own table, so
  listing items never drags image bytes through memory; `/api/photos` returns just the
  id list for row flags, and `<img>` points straight at the photo endpoint.
- **backup** — downloads the whole shop as one JSON document from the server.
- **db** — stopped being a "mirror" setting. The exe's SQLite file IS the live database;
  the screen shows where it is, and `db export` downloads a consistent copy taken with
  SQLite's own VACUUM INTO (safe while the shop is working, opens in any SQLite tool).
- **server** — this build IS the server. The screen reports the version, the URLs other
  devices can open, whether a token is required, and how to restart with `-lan`.
- **rollback** — the old build swapped in a checksummed JSON snapshot. The database has
  a transactional log instead, so `rollback N` walks back N reversible steps. Same
  capability, except every step is a real transaction rather than a whole-state swap.

## Verified
58 UI end-to-end checks. New ones cover: a count reaching the database and the history,
doctor/tidy over the whole inventory, merge adding quantities + removing the duplicate +
undo restoring it, remap rewriting bins and undoing in one step, a photo stored and
served back, the JSON backup, `/api/db` returning bytes that start with the real
"SQLite format 3" header, and the server/db/rollback screens.

Plus a COMMAND SWEEP: every command in the app is run and the page must raise no
error. It does not check what each one does — the checks above do that — it catches the
class of breakage a port introduces, like a function that now needs an await.

---

# v22.1 — the two side-builds become settings, not forks

## What the two files actually were
- `component-inventory-no-galaxy.html` — the v20.2 baseline with FOUR changes: a title
  marker, the galaxy menu entry removed, a `galaxy -> projects` guard in setGraphView,
  and galaxy dropped from the view cycle. Everything else about it being "different"
  was just it predating the export/report/png work.
- `orbit-mock.html` — main plus the ORBIT-SPEC implementation, which is already in
  (v21.3). Diffed function by function: `orbitParentMap`, `initOrbits` and `stepOrbits`
  are functionally identical to what shipped; only whitespace differs. Its one extra
  was a boot autostart that force-loads the demo, opens the galaxy and switches orbits
  on at every launch — mock scaffolding, deliberately NOT imported.

## Both are now settings
- `galaxy view` (default ON). Off: the galaxy is unreachable from the command, the view
  cycle, the HUD button and the demo, and its menu entry is hidden. One `galaxyOn()`
  helper is the only place that asks, and every entry point funnels through
  `setGraphView`, so a new entry point cannot miss the guard.
- `orbit motion` (default OFF, remembered per device). `graph orbit` still toggles it
  live and now writes the setting, so it is discoverable in `settings` rather than a
  hidden command, and leaving it on is a deliberate choice about spending the GPU.

This deletes the reason the no-galaxy fork existed. NOTES v20.2 admitted that fork could
not be rewound to a real pre-galaxy version and had to be re-derived from current code —
which is exactly the maintenance cost a setting avoids.

## On the CPU question
Worth recording, because it was the reason for wanting a toggle: the ordinary 3D graph
ALREADY repaints every frame. The force simulation stops once `gAlpha` decays past
0.015, but `gDraw()` and the animation-frame reschedule keep running because auto-rotate
drift is always on. Orbit mode therefore is not a heavier class of work — it replaces
the physics with `stepOrbits` (O(n) trig, trivial at 1500 nodes) and skips the force
loop. With orbit off the cost is one boolean check per frame.
If frames ever need to actually stop, the thing to change is the drift/redraw loop, not
orbit mode.

## Verified
66 UI checks (8 new): the galaxy setting neutralises the command, the view cycle and the
menu, comes back when switched on, and the orbit toggle records itself both ways.

---

# v22.2 — a real app window, and shop access as a switch

## "It feels web-based"
It was already a native program — one Go binary owning a SQLite database — but it drew
itself in a browser TAB, which is what made it feel like a web page.

`invos.exe` now opens a proper application window: Chromium app mode (`--app=`) with its
own profile directory. No tabs, no address bar, no bookmarks, its own taskbar entry and
icon. `-window=false` goes back to a normal browser tab.

Deliberately NOT an embedded webview. A webview means cgo, and cgo costs the single
static binary and the trivial cross-compile to a Raspberry Pi — a bad trade for a window
frame. Every Windows 10/11 machine has Edge; the kiosk boxes already run Chromium. If
the browser dependency ever becomes a problem, WebView2/WebKitGTK is the upgrade, and it
does not change anything above the launcher.

## Shop access is a switch now, not a restart
`-lan` used to be a startup flag. It is a toggle:
- `lan on` / `lan off` from the prompt, a `◉ shop` pill in the title bar while it is on,
  and the `server` screen shows the state and the address a tablet should open.
- The station's own listener is ALWAYS loopback and always up, so throwing the switch
  can never cut off the person standing at the machine.

Two bugs found by testing this, both of which would have shipped:

1. **The advertised address was junk.** `lanIPs()` returned every non-loopback IPv4,
   which on a real machine includes link-local (169.254.x.x, from an adapter with no
   DHCP) and virtual adapters. The first one won, so the tablet got an address that
   will never answer. Now real private ranges are preferred and link-local is dropped.
   Verified: it advertises 192.168.2.56, not 169.254.233.28.

2. **"Off" did not mean off.** Closing a listener stops NEW connections, but a tablet
   holding a keep-alive connection carried on being served after shop access was
   switched off. The shop listener now has its own `http.Server`, which can be Closed —
   dropping the listener AND every connection on it. The test proves the network
   address stops answering while the local one keeps working.

## No QR code (yet)
The plan was to show a QR so a phone could join by camera. The built-in encoder is
version 1 only — 14 bytes, which is right for a bin code like `INV:1101` and far too
small for a URL. It returned null and drew nothing. A QR that scans to nothing is worse
than typing the address, so it is left out until the encoder handles larger versions.
Roadmap item, not a silent gap.

## Verified
77 UI checks (11 new): shop access starts closed, `lan on` opens it and reports a real
LAN address, the station answers on that address, the local connection is unaffected
either way, `lan off` closes it, and the network address genuinely stops answering.

---

# v22.3 — the sections graph was drawing nothing

## The bug
Open the graph on the inventory ("sections") view and it showed the central sun and
nothing else — no departments, no shelves, no parts — even with the demo loaded.

`buildGraphData` reads `graphItems`, the graph's own bounded sample of the inventory
(added in v21.3, because `state.items` is only the rows on screen and a force
simulation over 100k nodes is not a thing anyone can look at). But the only thing that
ever FILLED `graphItems` was `graphSync()`, and `graphSync()` only runs after a save.
So the first time the graph opened it had an empty array and faithfully drew an empty
graph. Adding an item made it appear, which is why it looked intermittent rather than
broken.

## The fix
`ensureGraphItems()` — `buildGraphData` is synchronous and called from a dozen places
(view switches, HUD buttons, the physics loop), so it cannot await. It now asks for the
data on first use and rebuilds itself when it lands, re-heating the layout so the new
nodes settle. `graphSync()` invalidates the sample after a mutation.

## Why the tests missed it
The orbit checks asserted on the GALAXY view, which builds from `state.projects` — a
different data path that was never broken. Nothing asserted on the inventory graph's
contents, and "the page rendered" is not a useful assertion: an empty graph renders
perfectly well.

Now checked by node COUNTS: one part node per item in the database, departments and
shelves present, the galaxy's project cores and their parts, and a newly added item
appearing without a reload. 81 UI checks.

---

# v22.4 — the service worker was serving a stale UI (why the graph fix "didn't work")

## What was actually happening
The sections graph fix in v22.3 was correct and tested, but reloading the app still
showed only the sun. The fix was never reaching the browser.

`sw.js` cached the app shell CACHE-FIRST under a version name (`invos-v4`) that only
changed when someone remembered to change it. It had not changed since v21.2. So any
profile that had opened the app once kept serving the index.html it cached back then —
every UI fix since was invisible. New browser profiles saw the fixes, which is exactly
why the automated tests passed while the real window stayed broken.

This would have shipped. A customer on an old cached UI would report bugs that were
fixed months earlier, and no amount of reloading would help them.

## The fix: no service worker in this build
The old static app needed one — it was a page hosted elsewhere and the cache is what
made it work offline. The exe is not that. The UI is served over loopback by the process
that owns the database; if that process is not running there is no app to cache FOR.
A cached shell with no server behind it is a dead screen, not offline support.

- `sw.js` is now a worker whose only job is to delete its caches, unregister itself, and
  reload open windows. Its content changed, which is what makes browsers pick it up.
- `index.html` no longer registers a worker; it tears down whatever is there.
- Go serves the UI with `Cache-Control: no-cache, no-store, must-revalidate`. Re-reading
  200KB from a local socket is not a cost worth trading a wrong screen for.
- `install` now explains that the exe already IS the app on this machine, and that a
  phone should open the shop address and use Add to Home Screen. It no longer points at
  a browser install that cannot happen without a worker.

## Two new tests, because a fresh browser context can never catch this
- `test/ui/staleness.mjs` — builds, opens the app in a PERSISTENT profile, changes the
  UI, rebuilds, reloads, and requires the change to arrive.
- `test/ui/sw-recovery.mjs` — installs the OLD cache-first worker first, so the profile
  is in the exact state a real user is in, then ships the fix and requires the profile
  to recover on its own. Verified: it does, and the old caches and registration are gone.

Lesson worth keeping: smoke.mjs uses a fresh browser context every run, which has no
cache and therefore cannot see a caching bug. Testing the happy path from a clean state
proved nothing about the state users are actually in.

---

# v22.5 — orbits hold still while you are holding the graph

Orbiting nodes that keep moving under a held cursor make the graph impossible to grab:
the thing you are reaching for slides away as you reach for it.

`gLastXY` is set for exactly as long as a pointer is down, which is already the app's
"someone is interacting" signal. While it is set, orbit mode now freezes completely —
orbits do not advance and the camera does not drift — so a node stays under the cursor
and the scene does not slide out from under a rotate. Motion resumes the instant the
pointer is released.

Dragging a node in orbit mode used to be pointless: `stepOrbits` rewrote its position
from the orbital elements every frame, so it snapped straight back. On release, that
node's radius and angle are now re-derived from where it was dropped
(`recaptureOrbit`), so it carries on orbiting from its new place. You can rearrange a
cluster while it is running.

Verified with real mouse input rather than by calling functions: press and hold, sample
positions across several frames, require no movement; release, sample again, require
movement; and drag a node, then require its orbital radius to have changed instead of
reverting. 84 UI checks.

---

# v22.6 — the app tells you when the window is out of date

## Why
Twice now a shipped fix looked broken because the window on screen was still running
the previous build. A loaded page does not reload itself when the server behind it is
replaced, so after a rebuild the app in front of you is the OLD one — which is
indistinguishable from "the fix did not work". That cost two rounds of debugging on the
orbit-freeze change alone, and it will cost a shop the same when a station is updated.

## What
`web.BuildID()` is a short SHA-256 of the embedded index.html, so it changes whenever
the UI changes with nobody having to remember to bump a version. It is reported by
`/api/server`.

The page records the build it loaded with, then re-checks on window focus and every 30s.
If the server has moved on it says so in the terminal and puts a `⟳ update` pill in the
title bar that reloads on click. `health` shows both: `build  page a1b2c3d4 · server e5f6…`.

Checking on FOCUS is the important part — that is exactly the moment someone comes back
to the window after an update happened behind it.

## Verified
`test/ui/update-notice.mjs` — open a window, rebuild the UI under it, and require the
open window to notice by itself, say so on screen, show the pill, and clear the notice
after a reload. 7 checks. Also confirmed a UI change actually produces a different
build id, so the mechanism cannot silently no-op.

---

# v22.7 — shop access is in Settings, where people look for it

`lan on` worked, but a command nobody knows exists is not a feature. "How do I get this
on the tablet" is a settings question, so the settings screen now has a STATION section
below the display sliders:

    STATION
      shop access        on    tablets and phones can reach this inventory — click to close
                         http://192.168.2.56:8137
      window             app window   (invos -window=false for a tab)
      build              681f788d

The shop-access row is a click target (and Enter works on it like any other row). It
flips the switch, then repaints the section in place so the state and the address update
without leaving the screen.

Window mode is STATED rather than offered as a toggle. It is decided when the exe
launches, and a switch that silently did nothing until the next restart would be worse
than a sentence explaining the flag.

The galaxy and orbit toggles from v22.1 were already in this screen as on/off rows —
they just were not obvious next to the numeric sliders. The STATION heading gives the
non-cosmetic settings a place to live.

## Verified
90 UI checks. The new ones drive it the way a person would: open settings, confirm the
section and the state, CLICK the row, and require the server to actually close shop
access and the screen to repaint showing "off" — then click again and require it back on.

---

# v22.8 — visual parity audit against the HTML reference

Ran every visual surface against `component-inventory.html` rather than eyeballing it.

## Identical (no drift)
- head, CSS and body markup — byte-identical
- `THEMES` — all six palettes and font stacks
- every renderer: `gDraw`, `gDraw3D`, `nodeR`, `project`, `gPick`, `drawSweep`
- camera and sizing: `gDims`, `graphHome`, `popGraph`, `dockGraph`, `hexA`, `themeCol`
- physics in `gTick` — repulsion, springs, damping, the core-repulsion boost, `gAlpha` decay
- `SETTINGS` defaults, including **launchZoom 1.8** (the suspicion about launch zoom was
  unfounded — it is the reference value)
- orbit maths — `orbitParentMap` / `initOrbits` / `stepOrbits` are functionally identical
  to `orbit-mock.html`; only whitespace differs

Everything that DID differ was an intended data-source change (server queries instead of
an in-memory array) or a deliberate fix already recorded: the orbit branch, the galaxy
setting guard, the label draw guard, `graphItems`.

## One real regression, found and fixed
Part nodes in the **projects and galaxy views never showed low stock**.

Those nodes are built from BOM lines, not from item rows, and when that path moved to
the server the lines came back without `min`. `low: c.qty <= c.min` then compares a
number against `undefined`, which is always false — so nothing ever glowed amber. One
place had it worse: a hardcoded `min:0`, so a part only counted as low at exactly zero.

This is why it was hard to place. The graph still drew, laid out and animated correctly;
the only symptom was an absence — the amber that should have been there wasn't.

`min` is now joined onto `BomLine` server-side and carried through every synthetic item
the BOM path builds. The comment on the field says why it is there, because "why does a
BOM line carry the shop's reorder minimum" is a fair question.

## Noted, not a bug
The inventory graph draws at most `GRAPH_ITEM_CAP` (1500) parts, so above that the
department counts on the graph reflect the sample rather than the whole shop. That is
deliberate — a force simulation over 100k nodes is not viewable — and the label says
when it is showing a sample.

## Verified
91 UI checks. The new one asserts the FLAG rather than the picture: every item the
database reports as low must have `low === true` on its graph node. Checking "did it
render" could never have caught this.

---

# v23.0 — the graph scales: 1,000 nodes -> 20,000, and it looks like a galaxy

Measured first, because "make it faster" without numbers is guesswork. `test/ui/graph-bench.mjs`
times the simulation and the drawing SEPARATELY — they have different costs and different
fixes, and timing them together tells you nothing about which to work on.

## Baseline
     nodes   physics    draw     total     fps
       500     2.7ms    1.2ms     3.9ms    254
      1500    17.0ms    3.7ms    20.7ms     48
      5000   198.9ms   10.3ms   209.3ms      5
     15000  1702.8ms   31.9ms  1734.7ms      1
Physics was 98% of it and grew with the SQUARE of the node count: repulsion compared
every node against every other. Drawing was never the problem.

## What changed
**Spatial grid instead of all-pairs.** Above 1,200 nodes, parts only repel neighbours
within one cell radius. Below that the exact solver still runs, so a normal shop's graph
is bit-for-bit what it always was. The long-range spreading the exact solver provided is
produced explicitly instead: HUBS (sun, departments, sections, project cores) still repel
each other exactly — there are only ever a handful — and they are what pushes clusters
into separate galaxies.

**A neighbour cap.** A dense clump puts hundreds of nodes in one cell and the inner loop
goes quadratic again in a smaller box. Past ~12 near neighbours the extra shoves all point
the same way anyway.

**Parts become pixels.** Past 4,000 nodes the cost was CALLS, not pixels: every node was a
globalAlpha, a beginPath, an arc, a fillStyle and a fill — twice, because the bright core
is a second circle — and every edge its own stroke. Part positions are now written straight
into an image buffer and blitted once, the way a falling-sand game paints its world.
Brightness accumulates where stars overlap, which is what gives a dense cluster a glowing
core. Hubs stay real drawn shapes with labels; there are only ever a hundred of them.

## Three bugs the screenshots caught that the numbers did not
The benchmark went green while the picture was still wrong. Rendering fast is not the same
as rendering something.

1. **The simulation was exploding.** Coordinates reached 1e49. Forward-Euler plus springs
   that pull harder the further they stretch: anything flung far gets yanked back harder,
   overshoots further, diverges. Fixed with a per-frame speed cap (generous enough that a
   normal graph never reaches it) and a minimum separation so coincident nodes cannot
   divide by ~zero.
2. **The camera never zoomed out.** The layout spreads as nodes are added but the view
   opened at a fixed zoom, leaving everything off screen. It now fits the content — but
   never closer than the configured launch zoom, so a small shop's graph is unchanged, and
   it stops fitting the moment you zoom or pan yourself.
3. **Clusters did not grow with what they held.** A fixed spring length put 200 parts and
   3 parts the same distance from their hub, so a big shelf collapsed into a dot. Radius
   now grows with the square root of the count.

## And one quiet lie
`GRAPH_ITEM_CAP` was 1,500 but the fetch asked for it in ONE request while the server caps
a page at 1,000 — so the graph had been drawing 1,000 nodes and the constant was wrong.
It pages now, and the cap is 20,000.

## After
     nodes   physics    draw     total     fps
      1500     1.2ms    4.7ms     5.9ms    170
      5000     4.0ms    2.1ms     6.0ms    166
     20000    11.5ms    1.7ms    13.2ms     76   <- the new cap
     50000    32.3ms    4.0ms    36.2ms     28
    100000    72.6ms    7.9ms    80.5ms     12
15,000 nodes went from 1,735ms a frame to about 10ms — roughly 170x. 100,000 nodes is
now merely slow rather than impossible, at 78MB of heap.

91 UI checks still pass. `test/ui/graph-shot.mjs` seeds a large inventory and screenshots
the result, because this is the kind of work where the numbers can be perfect and the
picture still wrong.

---

# v23.1 — the orbit "flip": nodes were being drawn behind the camera

Reported as clusters snapping to the other side of the screen as they came close, and
generally janky flight compared with the previous build.

## Not a physics problem — a projection one
`project()` does `persp = gCamZ / (gCamZ + z2 + 300)`. When a node's rotated depth falls
past the camera plane that denominator goes NEGATIVE, and a negative perspective divide
MIRRORS the node to the opposite side of the screen at negative size. That is the flip,
exactly.

Measured on the demo galaxy, sweeping the camera through a full turn: ~3 nodes behind
the camera on an average frame and 166 draws at negative size. It was always latent —
the galaxy's clusters are far apart by design — but v23.0 made every layout bigger, so
it went from occasional to constant.

Nodes behind the camera are now culled, along with any edge touching one and anything
under the cursor for picking. 166 negative-size draws -> 0.

## And the flight itself
v23.0 scaled cluster radius with the number of things in a cluster, which the inventory
view needed — a shelf with 200 parts was collapsing to a dot. It should never have
applied to PROJECT hubs: the galaxy's 520 rest length is a tuned number (v20.2 chose it
so clusters sit far enough apart to pan between), and inflating it stretched the orbits
until nodes swung past the camera on every pass.

Scoped to inventory shelves only. The galaxy is back to its tuned size: nodes behind the
camera per frame went 3.1 -> 0, and per-frame screen movement is now p95 2px / worst
2.2px, which is a glide rather than a snap.

## On keeping the timeline
Every step here is its own commit, so "the previous iteration" is always recoverable —
`00fc366` is the build before the scaling work. Nothing needed reverting in the end: the
flip was a real bug worth fixing rather than a change worth undoing, and the layout
change only needed narrowing to where it belonged.

## Verified
`test/ui/orbit-probe.mjs` measures both: nodes drawn at negative size (must be zero) and
per-frame screen movement (a proxy for jank — smooth orbit is a couple of px). The
smoke suite's drag test was also rewritten to perform a REAL drag — press on the node,
move, release — instead of setting the drag state by hand, which was testing a path no
user takes and passed for the wrong reason. 91 UI checks.

---

# v23.2 — the view was laying itself out four times

Reported as: switching to a view starts, runs a few frames, restarts, then runs fine.

`buildGraphData()` ends with `gAlpha = 0.9` — a full re-heat of the simulation. So every
extra call is a visible restart. Counting them on the first `graph inv` found **four**:

1. `setGraphView` built the graph
2. `setGraph` built it again when opening the pane
3. `setGraph` built it a THIRD time — the auto-fit patch in v23.0 added a build and left
   the original call sitting right below it
4. the graph's item fetch landed and rebuilt with the real data

Now one:
- `setGraph` builds once, then fits the camera to what it built
- the view is chosen BEFORE the pane opens, so the pane builds the right view instead of
  building the old one and rebuilding for the new one
- `buildGraphData` refuses to lay out an empty inventory graph at all: if the parts have
  not arrived it starts the fetch and returns, so there is exactly one layout, when there
  is something to lay out. The pane says "reading the inventory…" in the meantime
- the fetch is warmed at boot, so opening the graph is usually instant anyway

## The measurement was wrong before it was right
The first probe watched `gAlpha` for re-heats and reported a clean 1 — because over
loopback the second build lands within milliseconds, before the polling loop even starts.
It was measuring after the event it was looking for. Counting `buildGraphData` calls
instead cannot be raced, and immediately showed 4.

Worth remembering: a probe that reports "fixed" proves nothing until it has been shown to
report "broken" on the broken code. This one was checked against the old build first.

## Also fixed a test that was passing by luck
The orbit drag check computed a node's screen position, then pressed there — by which
time the node had orbited away, so the press landed on empty space and the test only
passed when it happened to hit. It now presses FIRST (which freezes the motion, as it
should) and then asks what is under the cursor, trying a few points if the first misses.

91 UI checks. Orbit smoothness after all of this: p95 1.1px of screen movement a frame,
worst 1.7px, zero nodes drawn behind the camera.

---

# v23.3 — the "reset" was every node teleporting on the first orbit frame

You described it as: runs a bit, resets back to where it was a moment ago, then carries
on — and said the older build did it too. It did. This was in the orbit maths from the
original spec, not in anything recent.

## Measured
`test/ui/rewind-probe.mjs` records every node position every frame after a view switch
and looks for discontinuities. One spike, and it lands exactly on `initOrbits`:

    per-frame movement: median 0.59
    spikes: f164 = 212.1        <- initOrbits ran on this frame

A 360x jump against the median. Every node moves at once, so it reads as the whole
layout snapping.

## Why
`initOrbits` stored `r` = the 3D distance, `ang` = `atan2(dy,dx)` (a 2D angle), and
`incl` = a tilt picked from a seed. `stepOrbits` then rebuilt the position as
`(r·cos(ang), r·sin(ang)·cos(incl), r·sin(ang)·sin(incl))`.

Those cannot agree. The reconstruction only returns the node to where it was if `dz` is
zero and the seeded tilt happens to match the node's actual position — which it never
does. So the instant orbit mode engaged, every node jumped to a different point on its
sphere.

## Fix
The orbit is stored as a BASIS instead of angles: `u` is the unit vector to where the
node already is, `v` is perpendicular to it in the orbital plane, and the position is
`par + r·(u·cos θ + v·sin θ)`. At θ=0 that is exactly the current position, so engaging
orbit mode moves nothing. `v` comes from a per-node axis, so each orbit still gets its
own tilt; in 2D the axis is fixed to the screen normal or the circle would collapse to a
line. `recaptureOrbit` (used after a drag) rebuilds the same basis — its cross product
was also wrong, producing a `v` that was not perpendicular to `u`, so a dragged node's
radius drifted.

After: no spikes, no rewinds, median frame movement 0.52, per-frame screen movement
p95 1.1px.

## A process note worth keeping
The first attempt at this patch aborted midway — its second assertion failed, so the
script exited WITHOUT writing, and only the half that had already been applied
separately took effect. That left `stepOrbits` reading a basis that `initOrbits` never
wrote (`ux: undefined`), and the orbit silently stopped moving. The tests caught it
immediately; the state dump showed `ux: undefined` in one line. Patch scripts that
assert before writing are the right shape — but "it printed an error" has to be read as
"nothing was written", not "most of it worked".

92 UI checks, including a new one that fails if any node moves more than 40 units in a
single frame when orbit mode engages.

---

# v23.4 — orbits ease in instead of bursting

Reported straight after the teleport fix: it starts slow, then bursts into orbit. Not
intentional — v23.3 made the POSITION continuous at the handoff but left the VELOCITY
discontinuous.

Measured at the handoff frame:

    f161:0.04 f162:0.04 f163:0.04 | f164:1.26 f165:1.26 f166:1.26 ...

By the time the layout has settled the nodes are creeping along at 0.04 units a frame.
Orbits run at 1.26. Switching straight to full speed is a 31x jump in a single frame —
smooth in position, a jolt in motion, which is exactly what a burst looks like.

The orbit step is now scaled by a ramp that goes 0 to 1 over about a second, shaped with
a smoothstep so it is gentle at both ends. `stepOrbits` already took a `dt`, so this is
just passing the ramp instead of a constant.

    f164:0.00 f165:0.00 f166:0.01 f167:0.01 f168:0.02 ... f187:0.30 ...

The ramp resets whenever orbits are captured, so entering the view always accelerates
from a standstill. It does NOT reset when a held pointer is released — the motion was
already at full speed there, and re-ramping would look like a stall.

92 UI checks.
