# Getting the demo out

The goal of this first release is **not sales**. It is to stop guessing. Everything in
ROADMAP-v2.md about what shops need is reasoning from forum posts — a hypothesis. One week
of real users beats all of it, and the demo is the cheapest way to buy that.

So the bar is not "the product is finished". The bar is **"a stranger can try it in ten
seconds and tell me what is wrong"**.

---

## Where things point

**The demo URL points at GitHub.** Specifically:

- the **demo** is a static HTML file → GitHub Pages (`<user>.github.io/invos/demo`)
- every "get it" link → the **GitHub repo**, and downloads → the **Releases** page
- buy a domain later, when there is something to sell. A `github.io` URL costs nothing,
  never expires, and this audience trusts it more than a landing page with a logo.

**Do not build a mailing list yet.** Two reasons:

1. It contradicts the pitch. The demo's whole claim is "no signup, no account, instant" —
   and the first thing a visitor meets cannot be an email form.
2. **GitHub already is the mailing list.** "Watch → Releases only" notifies people when
   you ship, costs you nothing, has no privacy policy to write, no GDPR exposure, no
   sending reputation to manage, and no monthly fee. Ask for a star and a watch.

Revisit a mailer only when there is a paid version to announce and a reason for someone to
hear from you that is not a release.

---

## Before the first post

### 1. The demo itself — DONE, needs your test pass

Build it with `./make-release.sh`; everything below is verified by
`test/ui/demo-probe.mjs` (24 checks, run with no server at all).

- [x] **posture: everything on, data capped.** Nothing removed, nothing behind a "pro"
      label. The reason to buy is that the real one is yours.
- [x] **cap: 500 items.** It is a guardrail, not a paywall — its job is to stop somebody
      pasting ten thousand rows into localStorage, not to make the demo annoying enough
      to buy. The seed is ~124, so there is room to play for as long as anyone wants.
- [x] **seed: 124 items, 10 projects, all 10 departments, 10 shared parts.** Deliberately
      not electronics-only — a machinist opening a bin full of resistors is looking at
      somebody else's shop. Projects share parts on purpose: those overlaps are the
      bridges in the galaxy view, and without them the best screenshot is a row of blobs.
- [x] **it says what it is, and states the cap plainly**, in two lines on first open. No
      modal, no countdown, no nag.
- [x] **the guided `tutorial` starts itself** for a first-time visitor.
- [x] **`feedback`** — demo only, and the product says why it does not have one rather
      than pretending the command does not exist.
- [x] **survives a refresh** (localStorage). That is when it stops feeling like a mock-up.
- [ ] **works on a phone — YOUR TEST.** Run `invos.exe -lan`, open the printed https
      address on an actual phone, accept the certificate warning once. Resized desktop
      windows do not count.
- [ ] **walk the tutorial as a stranger — YOUR TEST.** Six steps. Note anything that made
      you hesitate; hesitation is the thing to fix.

### 2. The repo
- [ ] `README.md` first screen: the galaxy image, one sentence, the demo link
- [ ] a real capture at `docs/galaxy.png` — this is the single most valuable image here
- [ ] repo **topics** — paste these into Settings -> General (or the gear beside About):

      inventory  inventory-management  selfhosted  self-hosted  sqlite  golang  go
      workshop  makerspace  homelab  warehouse  stock-management  single-binary  agpl

      Topics are how this gets found by people already searching for it, which is most of
      GitHub's value as a channel. Also in `release/DEPLOY.md`.
- [x] LICENSE — **AGPL-3.0**, verbatim from gnu.org. Free for every shop; if someone runs
      a modified version as a service they must publish their changes. That is the
      standard choice when the SaaS is the business, and this audience recognises it.
- [ ] **set `INVOS_SOURCE_URL`** — the only thing still blocking a release build:

      INVOS_SOURCE_URL=https://github.com/<you>/invos ./make-release.sh

      It is stamped into the binary at build time, so it is a flag rather than a code
      edit, and **both build scripts refuse to run without it.** AGPL §13 requires that
      network users be offered the source, and `invos -version`, `/api/server` and the
      app's `license` command all print this address — shipping `REPLACE-ME` would be a
      licence failure, not a typo.
- [ ] `MANUAL.md`, `NOTES.md`, `ROADMAP-v2.md` linked from the README
- [ ] a real "About" one-liner on the repo

### 3. The release

**`./make-release.sh` assembles the whole upload into `release/`:**

    release/demo/       index.html + .nojekyll   -> GitHub Pages
    release/binaries/   4 platforms + SHA256SUMS -> GitHub Releases
    release/            LICENSE, README, MANUAL, DEPLOY.md

`DEPLOY.md` in that folder says where each part goes, including the Pages settings and
the repo About line. Both halves are built from the same `internal/web/ui/index.html`, so
the demo cannot drift from the product it is advertising.

- [x] `./build.sh` — windows/amd64, linux/amd64, linux/arm64, darwin/arm64 + SHA256SUMS
- [ ] tag it, and write release notes a person would read, not a commit dump
- [ ] **download and run each binary on a clean machine.** The first comment on any
      release post is somebody saying it does not start.
- [ ] say plainly that Windows binaries are unsigned and SmartScreen will warn — being
      first to say it is the difference between "honest" and "suspicious"

### 4. The clip (30-60s, no voice needed)
- [ ] type a search, watch it filter instantly
- [ ] `add` something — show the bin being chosen for you
- [ ] `labels` → the QR sheet
- [ ] `graph galaxy` → let it move for five seconds. This is the money shot.
- [ ] end on the terminal, not on a logo

### 5. Yourself
- [ ] pick a day you can be at a keyboard for the four hours after posting.
      **Answering comments IS the launch.** A post you abandon dies regardless of quality.
- [ ] write the "what it will not do" list into the post itself. That audience has been
      burned, and saying the limits first is what makes the rest believable.

---

## Post order

Do these one at a time, in this order, learning from each before the next.

**1. r/selfhosted — first, and it is not close.**
A single Go binary, no account, no cloud, owns a SQLite file you can copy: that
community's value system *is* this product's feature list. Large, active, and its readers
install things the same day.
- Title: what it is, plainly. No "I built a thing" and no emoji.
- Body: one line of what, two of why, the image, demo link, source link, the limits.
- Expect: "why not Grocy/Snipe-IT/Part-DB", licence questions, "does it do barcodes".
  Have honest answers ready — especially where the answer is "it does not".

**2. GitHub → awesome-selfhosted.** A PR to that list is a slow, permanent trickle of
exactly the right people, for years. Do it once the repo looks finished.

**3. Show HN — after the first round of complaints is fixed.** HN gives one attempt. The
build-log material is exactly its taste: 1702ms → 17ms, hunting a stutter to garbage
collection, building a fix for the wrong cause and measuring it.

**4. The forums the ERP observation came from.** Answering "how do you track inventory"
threads is on-topic, free, evergreen, and the person asking has the problem *today*.

**5. Maker communities** — r/machinists, r/hobbycnc, r/electronics, r/3Dprinting. Reframe:
lead with the galaxy image and the drawer labels, not the architecture.

**Skip Instagram for now.** The galaxy is genuinely photogenic, so the instinct is right —
but nobody adopts inventory software from IG, and it costs a posting habit to maintain.
Make the clip and embed it in the above instead.

---

## What to watch, and what would change the plan

Measure exactly one thing in the demo: **did they type a command?** People who type are
people who understood it. Everything else is vanity.

Then listen for the sentence that starts *"we can't use it because…"*. That sentence
outranks the entire roadmap. The plan in ROADMAP-v2.md is a hypothesis; the first real
shop is the evidence.

**Analytics on the demo page are fine. The product ships with none, ever** — "no internet,
no account, no phoning home" is the thing being sold, and instrumenting the exe would sell
it out.
