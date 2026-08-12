const CACHE = "wakespots-v1";
const ASSETS = [
  ".",
  "index.html",
  "data.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const u = e.request.url;
  // Прогнозы и карт-тайлы — только сеть, их не кешируем
  if (u.includes("open-meteo.com") || u.includes("cartocdn.com")) return;
  if (e.request.method !== "GET") return;
  // Сеть с обновлением кеша, при офлайне — из кеша
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
