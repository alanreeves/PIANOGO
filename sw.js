const APP_VERSION = "0.3.3";
const CACHE_NAME = `pianogo-${APP_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles.css",
  "./config.js",
  "./js/app.js",
  "./js/audio/engine.js",
  "./js/audio/piano.js",
  "./js/score/loader.js",
  "./js/score/timing.js",
  "./js/score/view.js",
  "./js/score/pdf.js",
  "./js/score/omr.js",
  "./js/session/runner.js",
  "./js/store/db.js",
  "./js/ui/stats.js",
  "./vendor/opensheetmusicdisplay.min.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./assets/icon.svg",
  "./assets/piano/LICENSE.txt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("pianogo-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(caches.match("./index.html").then((response) => response || fetch(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((response) => response || fetch(event.request)));
});
