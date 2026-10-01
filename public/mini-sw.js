/*
 * Staffora Mini App — service worker.
 * Maqsad: internet yo‘q joyda ham Mini App ochilsin va Face ID ishlasin.
 *  - /mini-app sahifasi: avval tarmoq, bo‘lmasa keshdagi nusxa;
 *  - /assets/* (nomida xesh bor) va /face-models/*: keshdan (o‘zgarmaydi);
 *  - /api/* hech qachon keshlanmaydi (shaxsiy ma’lumot va real vaqt).
 */
const VERSION = "staffora-mini-v1";
const SHELL = "/mini-app";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        cache.addAll([
          SHELL,
          "/face-models/tiny_face_detector_model-weights_manifest.json",
          "/face-models/face_landmark_68_tiny_model-weights_manifest.json",
          "/face-models/face_recognition_model-weights_manifest.json",
        ]).catch(() => undefined),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Mini App sahifasi: tarmoq birinchi (yangi versiya), aloqa bo‘lmasa — kesh.
  if (request.mode === "navigate") {
    if (!url.pathname.startsWith("/mini-app")) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(SHELL, copy));
          }
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Xeshli JS/CSS va Face ID modellari — keshdan, bo‘lmasa tarmoqdan olib keshga yozamiz.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/face-models/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
