/* INV.OS service worker — self-retiring.
 *
 * The old static build needed this: it was a page hosted somewhere else, and the cache
 * was what made it work offline. The exe is different. The app is served by the same
 * process that owns the database, over loopback. If that process is not running there
 * is no app to cache FOR — a cached shell with no server behind it is a dead screen.
 *
 * Worse, it actively broke things. The cache was keyed to a version name that only
 * changed when someone remembered to change it, so every UI fix after the last bump was
 * invisible to anyone who had already opened the app once. That is how the sections
 * graph appeared to stay broken after it was fixed.
 *
 * So this worker now exists only to remove itself and everything it cached. Once it has
 * run, the page stops registering a worker at all (see index.html).
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      await caches.delete(key);
    }
    await self.registration.unregister();
    // Reload whatever is open so it picks up the real, current UI immediately
    // instead of the copy this worker was still serving.
    for (const client of await self.clients.matchAll({ type: "window" })) {
      client.navigate(client.url).catch(() => {});
    }
  })());
});

// Never intercept a request again — everything goes to the local server.
