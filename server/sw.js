// No-op service worker for the server-injected voice edition.
//
// Stock OpenCode ships a Workbox service worker at /sw.js whose navigation
// route serves the cached app shell for every in-scope navigation. Its
// denylist covers /api, /auth and asset prefixes, but not /voice, so it hides
// both the injected microphone and the /voice/ settings page. Serving this
// no-op worker instead (skipWaiting + clients.claim, no fetch handler) makes
// the browser replace the old worker on its next update check and lets every
// request reach the network. OpenCode works fine without its offline cache.
//
// The reverse proxy must return this file for GET /sw.js on the OpenCode
// origin; see Caddyfile and README.md.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
