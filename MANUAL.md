# INV.OS — the manual

A keyboard-first inventory terminal for a workshop. One file, `invos.exe`. It contains the
whole interface and owns a real SQLite database — no install, no runtime, no account, no
internet. Run it and it opens.

Everything below is what the **current build** actually does.

---

## 1. Starting it

```
invos.exe                     # opens at localhost:8137
invos.exe -lan                # also reachable from tablets/phones on the shop wifi
invos.exe -db shop.db -port 9000 -token secret -open=false
```

| flag | what it does |
|---|---|
| `-db <path>` | which database file to use (default: your AppData / home folder) |
| `-port <n>` | port to listen on (default 8137) |
| `-lan` | listen on the whole network, not just this machine — prints the URLs to type |
| `-token <s>` | require this token on API calls; for a LAN you do not fully trust |
| `-open=false` | do not open a window on start (for a shop box that boots headless) |
| `-window=false` | open as a normal browser tab instead of an app window |
| `-version` | print the version and exit |

**Where your data lives:** one SQLite file. Type `db` in the app to see the exact path.
It is a normal file — copy it, back it up, put it on a USB stick. Nothing is in the cloud.

---

## 2. The idea in one minute

You type. It does. There are no forms to hunt through and nothing to click if you do not
want to.

- **Just start typing** to search. No command needed — any fragment, anywhere in the name,
  the value, the package, the notes, or the bin number.
- **`/`** opens the command menu if you would rather browse than remember.
- **tab / arrows** move down the rows on screen, **enter** opens the selected one.
- **esc** backs out of anything.

### Bins are self-describing (the Dewey model)

Every bin is a four-digit number that encodes its own location:

```
   1 4 0 3
   | | +-+-- the drawer
   | +------ section  (shelf 4 of department 1)
   +-------- department 1 — ELECTRICAL / ELECTRONICS
```

So `1403` is department 1, shelf 4, drawer 03. Nothing stores "category" as a field — it
is always *derived* from the number, so it can never drift out of sync with where the part
physically is. The ten departments and their shelves are renameable (`setup`, `sections`,
`class`), but the numbering is fixed and that is the point.

**C-IDs are permanent.** Every item gets a number like `C-0042` that is **never reused**,
even after the item is deleted. A label stuck on a drawer points at one thing forever.

---

## 3. Everyday commands

### Finding things

| command | what it does |
|---|---|
| *(just type)* | search everything — substrings match anywhere |
| `find <text>` | the same thing, explicitly |
| `l` / `list` | every item, grouped by shelf |
| `low` | everything at or below its minimum |
| `bins` | what is in each bin |
| `map` | the whole shelf tree |
| `info <id>` | the full detail card for one item |
| `stats` | totals at a glance |

### Changing things

| command | what it does |
|---|---|
| `add <name>` | add an item — it picks the shelf and a free bin for you |
| `take <id> <n>` | take stock off the shelf |
| `stock <id> <n>` | put stock back |
| `move <id> <bin>` | move an item to another bin |
| `edit <id>` | walk through the fields |
| `del <id>` | delete an item (or a whole bin) |
| `photo <id>` | attach a photo (stored in the database, not a folder) |
| `undo` | reverse the last change |

**Undo is real.** Every change writes a log row, and anything with an undo payload can be
reversed — including a whole spreadsheet import or a whole project build, which back out
as ONE step rather than four hundred.

### Projects

| command | what it does |
|---|---|
| `project <name>` | start or open a project |
| `proj <name>` | same thing, shorter |
| `build <name>` | take the project's whole bill of materials off the shelves |

A project holds a BOM — a list of parts and how many. `build` consumes them in one
transaction: either the whole build comes off the shelf or none of it does, and one `undo`
puts it all back along with the status change.

### Counting and tidying

| command | what it does |
|---|---|
| `count <bin>` | cycle-count: walk a bin, confirm or correct each quantity |
| `doctor` | find duplicates and messy entries |
| `tidy` | clean up item names |
| `remap` | renumber bins |
| `health` | data integrity and storage status |
| `recent` | the activity log |

### Getting data in and out

| command | what it does |
|---|---|
| `import` | a spreadsheet — .xlsx .xls .xlsm .ods .csv .tsv |
| `import paste` | paste rows straight from Excel or Sheets |
| `template` | download a blank CSV with the right columns |
| **`import legacy <file>`** | **move a shop off the old single-file HTML build** |
| `export` | CSV · `export full` for xlsx · report · photos |
| `graph png` | save the current graph as an image |
| `backup` | write a consistent copy of the database to a file |
| `db` | where the physical SQLite file is |
| `rollback` | revert to an earlier saved state |

### Labels and scanning

| command | what it does |
|---|---|
| `labels <bin>` | print QR labels for a bin or a range |
| `scan` | camera-scan a bin label |

---

## 4. Moving off the old HTML build

If your inventory is in the old single-file app, this is how it comes across.

```
import legacy C:/shop/old-export.json     # reports what it WOULD do — writes nothing
import legacy confirm                     # actually does it
import legacy                             # or pick the .json with a file dialog
```

It reads every shape the old build wrote: the `.json` the download button produced, the
checksummed backup envelope, an old `invos.db`, and a blob-server response. A `.db` must
be given **by path** — a browser cannot read a SQLite file.

**The first run only reports.** It tells you how many items and projects it found, and
names every row that cannot come across — a BOM line pointing at a part that is not in the
file, a bad shelf code, a duplicate number. Nothing is written until you type `confirm`.

**Your C-IDs come across unchanged**, because your labels are already on the drawers. For
the same reason it will **refuse** to import into a database that already uses any of those
numbers rather than renumbering — two drawers claiming one number is not something to
resolve automatically. Import into a fresh database.

The whole import is one entry in the log, so `undo` backs all of it out.

---

## 5. Letting the shop in (tablets and phones)

Type `server` to see this station's address and a QR code, or `lan` to toggle shop access
on and off **while it is running** — no restart.

With it on, any device on the same wifi opens the URL it prints and sees the same
inventory, live. It is one database; two people editing are editing the same rows.

For a network you do not trust, start with `-token secret` and callers must present it.
This is deliberately not an account system — it is a shop, not a bank.

---

## 6. The graph

`graph` opens the node view beside the terminal. It is not decoration: it is how you see
what is connected to what.

| command | view |
|---|---|
| `graph` | open it (split view) |
| `graph inv` | the inventory — departments, shelves, parts |
| `graph projects` | every project; links are the parts they share |
| `graph galaxy` | projects as clusters of orbiting parts |
| `graph 3d` / `graph 2d` | switch dimensions |
| `graph full` / `graph off` | fill the screen / close it |
| `graph home` | recentre |
| `graph orbit` | let it revolve (a show mode, off by default) |
| `graph png` | save it as an image |

**Driving it:** drag empty space to rotate, drag a node to move it, scroll to zoom,
**alt+h** recentres, **alt+g** cycles the view. Click a node to drill into it.

Low stock shows amber, so a project that cannot be built right now is visible at a glance.

### Graph settings (`settings`)

| setting | default | what it does |
|---|---|---|
| launch zoom | 1.8x | how close it opens |
| auto-orbit | 2.2 | the slow drift; **0 turns it off and lets the graph sleep** |
| glow strength | 100% | node glow |
| dust field | on | background starfield |
| part-label zoom | 1.1x | how close you lean in before part names appear |
| galaxy view | on | off hides the galaxy everywhere |
| orbit motion | off | parts orbit their project — costs a frame every frame |
| orbit speed | 1.0x | how fast they go round |
| orbit size | 1.00x | how wide the orbits are; below 1 pulls parts in |
| spin resumes in | 4s | after a drag, when the rotation comes back (0 = never) |
| after a drag | auto-home | `auto-home` levels the tilt · `follow the drag` keeps your direction |
| graph nodes | 20k | how many nodes to draw at most |
| pause when idle | on | stop drawing when nothing moves (auto-orbit keeps it awake) |

Settings are **per device**: the tablet at the bench and the office PC each keep their own.
`save these as the shop default` in the settings screen stores a starting set that a
*brand-new* device picks up on its first run — devices already set up keep what they have.

---

## 7. Keyboard

```
tab / down          move down the rows          shift+tab / up   move up
enter               open the selected row, or run what you typed
ctrl+enter take     shift+enter stock           p   add to project
esc                 drop the cursor / back / home
/                   command menu                tab (while typing)  complete
alt+h               recentre the graph          alt+g   cycle graph view
f1 menu  ·  f2 doctor  ·  f3 3D graph
ctrl+u / ctrl+w / ctrl+k    clear line / word / to end
ctrl+a / ctrl+e             start / end of line
pgup / pgdn         scroll
```

`alt+g` and `alt+h` use alt on purpose — the bare letters would make "graph", "help",
"glue" and "health" impossible to type.

---

## 8. Setting up a new shop

1. `setup` — name the shop and rename the ten departments to match your space.
2. `sections` — add and name the shelves inside each department.
3. `template` then `import` — or just `add` things as you go.
4. `labels` — print QR labels and stick them on the drawers.
5. `server` — turn on shop access so the tablets can see it.
6. `backup` — and put the file somewhere that is not this machine.

`demo` loads sample data if you want to explore first; it is clearly marked and easy to
clear.

---

## 9. What it will not do

Honesty is more useful than a feature list:

- **No accounts or permissions yet.** Anyone who can reach the address can edit. The token
  is a door lock, not a user system.
- **No check-out / custody yet** — you cannot record who took a tool and has not returned it.
- **No supplier or reorder workflow yet** — no buy list grouped by supplier.
- **Scanning is a command, not a mode** — no continuous scan loop or USB wedge support yet.
- **LAN has been exercised on localhost, not across a real shop floor.** It works; it has
  not been hardened against two people editing the same row from opposite ends of the
  building.

All of those are on the roadmap; see `ROADMAP-v2.md`.

---

## 10. If something goes wrong

| symptom | what to do |
|---|---|
| a change looks wrong | `undo` — it goes back one step at a time |
| the numbers look impossible | `health`, then `doctor` |
| you want an older state | `rollback` |
| a tablet cannot connect | `server` — check shop access is on and you typed the right URL |
| you want your data elsewhere | `db` for the file path, or `backup` for a safe copy |

The database is one ordinary file. Whatever else happens, you can copy it.
