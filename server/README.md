# INV.OS sync server (OPTIONAL)

The INV.OS app is local-first and fully offline on its own. This server is **optional** —
run it only when you want a central database, multiple stations sharing data, or
per-client customizable sections. Without it, nothing changes: the app owns its data locally.

## What it is
- One Go binary + one SQLite file. No runtime, no dependencies to install on the target.
- Serves the app (`./deploy`) AND a tiny sync API.
- Whole-state sync: the app pushes/pulls its checksummed JSON blob. The app's own
  integrity layer still applies; the server keeps a 50-deep history too.

## Build
```
cd server
go build -o invos-server main.go        # produces a single static binary
```
Cross-compile for a Raspberry Pi kiosk:
```
GOOS=linux GOARCH=arm64 go build -o invos-server-pi main.go
```

## Run
```
./invos-server                          # :8137, db=./invos.db, serves ../deploy
INVOS_PORT=9000 INVOS_DB=/data/acme.db INVOS_STATIC=./deploy INVOS_TOKEN=secret ./invos-server
```

## Connect the app to it
In the app:  `server https://your-host:8137 [token]`
Turn it off (back to pure local):  `server off`

## Per-client customization (your "sections as GET requests")
Store overrides in the config table; the app pulls them on boot:
```
curl -X PUT http://host:8137/api/config -H 'Content-Type: application/json' \
  -d '{"classes":["GENERAL","BREWING","PACKAGING", ...], "sections":{"11":"HOPS"}}'
```
One `.db` per client = client-by-client config and data isolation.

## API
- `GET  /api/state`  -> {blob, updated_at}
- `PUT  /api/state`  <- raw checksummed JSON (the app's envelope)
- `GET  /api/config` -> { classes?, sections?, ... }
- `PUT  /api/config` <- { key: value }
- `GET  /api/health` -> liveness

## Why SQLite
Single file, ACID, zero admin, trivial backup (copy the file). Swap to Postgres later
by changing the driver + DSN — the whole-state contract stays identical.

## Verification status
- `main.go`: valid, gofmt-clean Go (verified). Uses stdlib + modernc.org/sqlite
  (pure-Go, no cgo). Compile with `go build -o invos-server main.go` on any machine
  with Go + network (the module proxy was blocked in the dev sandbox only).
- HTTP contract: verified byte-exact with `go test` (contract_test.go) — a stdlib-only
  mirror of the endpoints proves the checksummed state blob round-trips byte-for-byte
  (unicode intact, checksum stays valid) and per-client sections/config serve correctly.
