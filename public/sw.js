// Service worker: the app works offline after the first visit.
// - The page itself: network first, cached copy when offline.
// - Hashed assets (JS, CSS, cards.json) and the icons: cache first.
// - Card images: cached when they are shown, kept across versions (they never change).
// The version comes from the registration URL (sw.js?v=<build id>); old caches are removed on activation.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `gcg-app-${VERSION}`;
const IMAGES = "gcg-card-images";
const SHELL = ["./", "./manifest.webmanifest", "./icon.svg", "./icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== IMAGES).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // e.g. the Limitless API: always the network

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./", copy));
          return response;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }

  const cacheName = url.pathname.includes("/cards/") ? IMAGES : CACHE;
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(cacheName).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
