// OposiVoz · funciona sin conexión (en el coche, en el metro): primero la red y, si no hay, lo último guardado.
const CACHE = "oposivoz-e1bbd83";
const BASE = ["./", "index.html", "estudiar.html", "css/estilo.css", "css/fuentes.css", "js/motor.js", "js/app.js",
  "bancos/indice.json", "icono.svg", "manifest.webmanifest", "fuentes/atkinson-latin-400.woff2", "fuentes/atkinson-latin-700.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: url.pathname.includes("/bancos/") })));
});
