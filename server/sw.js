// Network-only worker for this OpenCode app. Served at <basePath>voice/sw.js
// with Service-Worker-Allowed: <basePath>, and registered at that exact app scope.
// No fetch handler: app navigations and voice requests always reach the proxy.
//
// The blocking bootstrap redirects the original app or stock root registration
// call to this exact app scope. Existing clients whose legacy worker still
// serves a cached shell must first reach a network-served injected document;
// they cannot be repaired by code that their cached HTML never loads.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  // Workbox's default precache name ends with the complete registration scope.
  // Delete only that exact app-owned name, never all Workbox or origin caches.
  // Custom cache names cannot be attributed safely and are deliberately retained.
  try {
    await self.caches.delete(`workbox-precache-v2-${self.registration.scope}`);
  } catch {
    // Storage may be disabled or unavailable; keep the network-only worker usable.
  }
  await self.clients.claim();
})()));
