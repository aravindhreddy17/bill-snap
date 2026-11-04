// App shell cached so it opens offline; API calls are never cached. (Scanning itself needs network.)
const C = "bill-snap-v1", SHELL = ["/", "/app.js", "/shared.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icon-180.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x))))));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
