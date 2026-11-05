// Circle service worker. BUILD 6
// Only makes Circle installable. It keeps nothing offline: profiles and photos are never stored on the phone by it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // pass-through: the browser fetches as usual
