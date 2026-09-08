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

### 1. The demo itself
- [ ] decide the demo posture (ROADMAP D1): **everything on, data capped**, nothing hidden
      behind a "pro" label. Not crippleware — the reason to buy is that it is yours.
- [ ] seed on load so the first screen is never empty
- [ ] cap the item count, and say so plainly in one line
- [ ] the guided `tutorial` runs (or is offered) on first open — a stranger with a blinking
      cursor and no instructions is a stranger who closes the tab
- [ ] a `feedback` command, demo only: one keypress from being annoyed to telling us
- [ ] it survives a refresh (localStorage) — that is when it stops feeling like a mock-up
- [ ] works on a phone. Open it on an actual phone, not a resized window.

### 2. The repo
- [ ] `README.md` first screen: the galaxy image, one sentence, the demo link
- [ ] a real capture at `docs/galaxy.png` — this is the single most valuable image here
- [ ] repo topics: `inventory`, `inventory-management`, `selfhosted`, `sqlite`, `golang`,
      `makerspace`, `workshop`
- [x] LICENSE — **AGPL-3.0**, verbatim from gnu.org. Free for every shop; if someone runs
      a modified version as a service they must publish their changes. That is the
      standard choice when the SaaS is the business, and this audience recognises it.
- [ ] **replace `sourceURL` in cmd/invos/main.go** with the real repo address before
      cutting a release. AGPL §13 requires network users be offered the source, and
      `invos -version`, `/api/server` and the app's `license` command all print it —
      shipping `REPLACE-ME` would be a compliance failure, not a typo.
- [ ] `MANUAL.md`, `NOTES.md`, `ROADMAP-v2.md` linked from the README
- [ ] a real "About" one-liner on the repo

### 3. The release
- [ ] `./build.sh` — windows/amd64, linux/amd64, linux/arm64, darwin/arm64 + SHA256SUMS
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
