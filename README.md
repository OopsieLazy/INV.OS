# INV.OS

**A keyboard-first inventory terminal for a workshop.** One file. No install, no runtime,
no account, no internet. Run it and it opens.

<!-- Replace with a real capture of `graph galaxy` before publishing. It is the hook. -->
![the project galaxy](docs/galaxy.png)

```
› 10k
  C-0042  Resistor 10k        BIN 1101   qty 180   ELECTRICAL / RESISTORS
```

You type, it does. Search is just typing — any fragment, anywhere in a name, a value, a
package, a note, or a bin number. Everything else is one short command.

---

## Why it exists

Most small shops track inventory in a spreadsheet they know is wrong, because the only
thing above a spreadsheet is an ERP — and an ERP is a project: licences, an
implementation, months before anyone benefits. A shop with 4,000 parts and six people
never clears that bar.

INV.OS is the missing rung. It does the physical job — what is here, where is it, who has
it, how much is left — and gets out of the way.

## What you get

- **One binary.** Windows, Linux, macOS, and a Raspberry Pi. Nothing to install.
- **Your data is a file.** An ordinary SQLite database you can copy to a USB stick. No
  cloud, no export ransom.
- **Self-describing bins.** `1403` = department 1, shelf 4, drawer 03. The category is
  always derived from the number, so it cannot drift from where the part physically is.
- **IDs that are never reused.** A label stuck on a drawer points at one thing forever —
  even after a delete, even after an undo.
- **Real undo.** Every change is reversible, and a 400-row import or a whole project
  build undoes as *one* step.
- **Works on the shop's tablets.** One command opens LAN access, encrypted, no restart.
- **A node graph** of your inventory and your projects that scales to 20,000 nodes at
  60fps — including which parts two projects share.
- **It scales.** 100,000 items: search 2ms, home screen 0ms, flat memory.

## Try it

- **Live demo** — no signup, nothing to install: *(link)*
- **Download** — *(releases)*

```bash
invos.exe                # opens at localhost:8137
invos.exe -lan           # also reachable from the shop's tablets, over https
```

Then type `tutorial` for a one-minute guided tour, or just start typing.

## The everyday commands

| | |
|---|---|
| *(just type)* | search everything |
| `add 10k resistor x50` | add an item — it picks the shelf and a free bin |
| `take C-0042 5` · `stock C-0042 20` | off the shelf, back on the shelf |
| `low` | everything at or below its minimum |
| `map` | the whole shelf tree |
| `project <name>` · `build <name>` | a bill of materials, and consuming it in one step |
| `count <bin>` | cycle-count a bin walk |
| `labels <bin>` | print QR labels |
| `who <name>` | who is at this station — logged with every change |
| `graph galaxy` | projects as clusters of orbiting parts |
| `import` | a spreadsheet: xlsx, xls, ods, csv |
| `undo` | reverse the last change |

Full command reference and setup guide: **[MANUAL.md](MANUAL.md)**.

## Coming from a spreadsheet

`template` gives you a blank CSV with the right columns; `import` reads xlsx, xls, ods,
csv, or rows pasted straight from Excel. Coming from the older single-file HTML build,
`import legacy` moves everything across **keeping your original C-IDs**, because your
labels are already on the drawers. It reports what it will do before it writes anything.

## What it will NOT do

More useful than a feature list, and none of these are secretly planned for next week:

- **No accounts or permissions.** Anyone who can reach the address can edit. The optional
  token is a door lock, not a user system. `who <name>` is a *claim*, not a login — it
  answers "who took the last one", not "prove it".
- **No check-out / custody yet.** It cannot tell you who has a tool and has not returned
  it. *(Next up.)*
- **No purchasing.** Reorder points and a supplier buy list are planned; purchase orders
  with approvals, receiving and three-way matching are **not** — that is where ERP begins
  and this deliberately stops.
- **No shipping.** No carrier rates, labels or tracking. If you ship product, you want a
  shipping app as well as this.
- **No accounting integration.** Export is the integration. Getting a ledger subtly wrong
  costs someone their books.
- **No multi-warehouse, lot, serial or expiry tracking.** Those exist for regulated and
  food/pharma inventory, and adding them taxes every screen for everyone else.
- **Scanning is a command, not a mode.** No continuous scan loop or USB wedge support yet.
- **The database is not encrypted at rest.** It is an ordinary SQLite file — which is
  exactly what makes it yours and portable.
- **LAN has been tested between browsers, not across a real shop floor.** It works; it has
  not been hardened against two people editing the same row from opposite ends of a
  building.

Security posture, including what the self-signed certificate does and does not buy you, is
in [MANUAL.md §6](MANUAL.md).

## Building it

Go 1.27+. The SQLite driver is pure Go, so there is no cgo and no cross-toolchain:

```bash
go build -o invos.exe ./cmd/invos     # the product
./build.sh                            # every platform, versioned, with checksums
go test ./internal/...                # store tests
cd test/ui && node smoke.mjs          # end-to-end: real binary, real browser, real database
```

The end-to-end suite launches the actual binary, drives the actual terminal in headless
Chromium, then reads the server back to prove the typing reached SQLite.

## Status

Working and used, not yet 1.0. [NOTES.md](NOTES.md) is the changelog — it records what was
measured and why, not just what changed. [ROADMAP-v2.md](ROADMAP-v2.md) is the plan.
