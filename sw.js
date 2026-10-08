// Glasspad offline support: keeps the app and its fonts on the phone so it opens without a connection.
const VERSION = "glasspad-test-5.50";
const SHELL = ["./", "index.html", "lame.min.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "start-portrait.webp", "start-landscape.webp"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // the app page: try the network first so updates arrive, fall back to the saved copy offline
  if (req.mode === "navigate") {
    // only the app itself is saved for offline use (other pages, like test.html, are just passed through)
    const isApp = /\/(index\.html)?$/.test(url.pathname);
    if (!isApp) return;
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put("index.html", copy)); return res; })
      .catch(() => caches.match("index.html")));
    return;
  }
  // fonts and app files: use the saved copy, refresh it in the background
  if (/kit-.*\.json$/.test(url.pathname) || /test\.html$/.test(url.pathname)) return;   // test files go straight to the network
  if (url.origin === location.origin || url.host.endsWith("fonts.googleapis.com") || url.host.endsWith("fonts.gstatic.com")) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
