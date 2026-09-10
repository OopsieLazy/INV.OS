# Getting to the station from outside the shop

The station serves your local network and refuses everything else. That is the right
default, and it is also the thing in the way when you want your own inventory from a
customer's site or your sofa.

Three ways to fix that. One of them is right for almost everybody.

---

## The short answer

**Use Tailscale.** Free, no domain, no open ports, no certificate, and the login is the
one you already have with 2FA on it. Ten minutes, and it is the safest of the three by a
distance.

Use a **Cloudflare Tunnel** *as well* only if you need to hand a plain URL to somebody who
will not install anything.

**Do not forward a port.** More on why below.

---

## 1. Tailscale — recommended

A private network between your own devices. Every device gets a stable address in
`100.64.0.0/10`, they talk directly and encrypted, and nothing is exposed to the internet
at all — there is no door to knock on, so no one can knock.

```
1. Install Tailscale on the shop box and on your laptop/phone.
2. Sign in on both with the same account (GitHub or Google — 2FA applies).
3. On the box:   invos.exe -lan
4. From anywhere: https://<the box's tailscale name>:8137
```

Turn on **MagicDNS** in the Tailscale admin and the box gets a name, so you type
`https://shop-pc:8137` rather than remembering an address.

**Why this is the safe one:** there is no public endpoint. A port scan of your home
address finds nothing, because nothing is listening there. Access is per-DEVICE — a lost
phone is one click to revoke, and revoking it does not disturb anything else. That is
better than any password.

Cost: free for personal use, comfortably inside the limits for one shop.

**INV.OS understands this range.** `100.64.0.0/10` is not RFC1918, so the station's
"local network only" guard used to refuse it — Tailscale would have been blocked by our
own defence. It is treated as local now, and the public internet still is not.

### Do I have to log in every time?

**No — and this is the part that makes it worth doing.** You sign in once per device,
ever. Neither machine asks again.

- **The shop PC:** install it as a service and it connects on boot, before anyone logs
  into Windows. You never touch it. **Turn off key expiry for that machine** in the
  Tailscale admin (Machines → the box → Disable key expiry), or it will log itself out
  after about six months and the first you hear of it is the day you need it.
- **Your iPhone:** the app stays signed in. Tailscale appears as a VPN profile; leave it
  on, or flick it on when you want the shop. There is no login either way — the switch is
  just a switch. Idle battery cost is negligible; it is only moving data when you are
  using it.

So the answer to your question is: **the PC is always on the tailnet, and on the phone you
just toggle the VPN.** No password, no IP to remember.

### And you do not type an IP

Turn on **MagicDNS** and the box gets a name. `https://shop-pc:8137` from anywhere,
instead of remembering `100.x.y.z`.

One wrinkle worth knowing: the station's certificate covers its addresses, including the
tailnet one, but it cannot know your MagicDNS name — so browsing by NAME gives a
certificate warning even though browsing by ADDRESS does not. Accept it once per device,
same as on the shop wifi, or use the address if that bothers you.

If you would rather have neither warning: over a tailnet the traffic is already encrypted
end to end by WireGuard, so `lan http` is a defensible choice there — you are not sending
anything in the clear, you are letting the mesh do the encrypting. That does mean the shop
wifi is unencrypted too, though, so it is a trade rather than a free win.

### If you want it easier to start

Tailscale can run as a service, so the box is on the network from boot. The kiosk
installer already runs INV.OS as a systemd unit; add Tailscale's own service beside it and
there is nothing to start by hand ever again.

---

## 2. Cloudflare Tunnel — when someone else needs a link

Gives you `https://inventory.yourdomain.com` with a real certificate and no open ports.
`cloudflared` runs on the box and dials OUT to Cloudflare, so again there is nothing
listening for strangers.

Put **Cloudflare Access** in front of it — free for up to 50 users — and you get a login
page that accepts GitHub or Google, with 2FA, before anyone reaches the app. That is the
"minimal logins" you asked about: no account system in INV.OS, the identity is one you
already have.

Cost: a domain, roughly £8–12 a year. Tunnel and Access are free at this size.

### The catch, and it matters

**A tunnel makes every visitor look local.** `cloudflared` forwards to `127.0.0.1`, so
every remote person arrives as loopback — and INV.OS deliberately exempts loopback from
the key, because whoever is sitting at the machine can read the database file anyway.
Behind a tunnel that exemption would hand the whole inventory to anyone who got past the
front door.

So when you run a tunnel:

```
invos.exe -lan -token <something-long> -require-key
```

`-require-key` drops the loopback exemption, so the key applies to everybody including
things claiming to be local. The binary refuses to start with `-require-key` and no key,
rather than looking protected and not being.

Belt and braces: Cloudflare Access in front, the key behind it.

### So how exposed am I, really?

Honest answer: **a tunnel with Access in front is genuinely solid, and the domain is not
what makes it so.** Worth being precise about what you are buying, because "Cloudflare
covers it" is true of some things and not others.

**What Cloudflare does cover**

- **No inbound ports.** `cloudflared` dials out. Your router has nothing open, so there is
  nothing to scan and nothing to brute-force at the network level. This is the big one.
- **A real certificate**, so no self-signed warnings and no one training themselves to
  click through them.
- **Authentication happens BEFORE your app.** With Access on, an unauthenticated request
  never reaches the station at all. Your inventory is not what is fending off the
  internet — Cloudflare is, and they are considerably better at it.
- **DDoS and bot filtering**, free, at a scale you could not buy.
- **A log of who logged in and when**, which INV.OS itself deliberately does not do.

**What it does not cover, and what is therefore yours**

- **Anyone who passes Access has full access.** There are no permissions in INV.OS — the
  login decides whether, never what. Keep the Access policy to specific email addresses,
  not "anyone with a Google account".
- **A bypassed or misconfigured Access policy exposes everything.** The single most common
  mistake is publishing the tunnel first and adding the policy afterwards. Do it the other
  way round, and check it in a private window before you rely on it.
- **The loopback exemption.** Covered above: without `-require-key`, everyone through the
  tunnel arrives looking like the person at the machine. This is the one that would bite
  you specifically, because it is invisible when it goes wrong — it just works, for
  everybody.
- **The box itself.** A tunnel makes one app reachable, not the machine. That is fine
  until the machine is unpatched and something else on it is also listening.
- **Your own account.** The tunnel is only as good as the Cloudflare login that controls
  it. Put 2FA on that one, not just on Access.

**Compared to Tailscale:** a tunnel has a public front door with a good lock, where
Tailscale has no door. Tailscale is strictly safer. A tunnel is more convenient, and the
gap between them is small enough that "always up, works on anything, no client to install"
is a fair reason to choose it — as long as `-require-key` is set and the Access policy
names actual people.

**The domain buys none of this.** It buys a name. The security comes from Access and from
having no open ports, both of which are free.

### A tunnel, start to finish

```
1. Buy a domain, point its nameservers at Cloudflare (their dashboard walks you through).
2. Zero Trust -> Access -> Applications -> Add: self-hosted, inventory.yourdomain.com
   Policy: Allow, emails -> list the actual addresses. Do this BEFORE step 4.
3. On the shop box:  invos.exe -lan -token <something-long> -require-key
4. cloudflared tunnel --url http://127.0.0.1:8137
   (then `cloudflared service install` so it comes up on boot)
5. Open it in a private window. You should get a login you cannot skip.
```

Step 2 before step 4 is the part people get wrong.

---

## 3. Port forwarding — no

It is the cheapest and it is the one that gets shops on the news. You would be putting an
unauthenticated inventory server on the public internet behind a self-signed certificate,
and the only thing between it and the world is a token you typed in once.

INV.OS refuses non-local addresses precisely so this cannot happen by accident — you would
have to set `-open-to-internet` on purpose. If you ever find yourself reaching for that
flag, one of the two options above does the same job better and free.

Dynamic DNS does not change any of this. It makes the bad option easier to reach.

---

## Which to pick

| | Tailscale | Cloudflare Tunnel | Port forward |
|---|---|---|---|
| cost | free | ~£10/yr for a domain | free |
| open ports | none | none | yes — the problem |
| who can reach it | your devices only | anyone with a login | anyone, ever |
| login | your existing account + 2FA | GitHub/Google + 2FA | the key, and that is all |
| revoking a lost phone | one click | one click | change the key everywhere |
| someone with no software | cannot | can | can |
| effort | 10 minutes | an hour, once | 5 minutes and a lifetime of worry |

**Start with Tailscale.** It costs nothing to try and you can add a tunnel later if you
ever need to hand somebody a link. There is no reason to run both from day one.
