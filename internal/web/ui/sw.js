/* INV.OS service worker.
 *
 * The shell (HTML, icons, lazily-loaded libraries) is cached so the station starts
 * instantly and survives a flaky network. The DATA is not: this build reads and
 * writes a real database over /api/, and a cache-first strategy there would hand
 * back a stale inventory forever — a bin that says 40 when the drawer holds 4.
 *
 * So: /api/ is network-only, everything else is cache-first.
 */
const CACHE = "invos-v4";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png",
  "./icon-512.png", "./xlsx.full.min.js", "./sql-wasm.js", "./sql-wasm.wasm"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Never cache the API. Let it go straight to the network, and let a failure be a
  // failure — the app shows "cannot reach the server" rather than inventing data.
  if (url.pathname.startsWith("/api/")) return;

  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
