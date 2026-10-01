/*
 * Staffora Mini App — service worker.
 * Maqsad: internet yo‘q joyda ham Mini App ochilsin va Face ID ishlasin.
 *  - /mini-app sahifasi: avval tarmoq (3 soniya), bo‘lmasa keshdagi nusxa;
 *  - o‘rnatishda sahifadagi JS/CSS va Face ID modellari oldindan keshlanadi;
 *  - /assets/* (nomida xesh bor) va /face-models/*: keshdan (o‘zgarmaydi);
 *    kerak bo‘lganda yuklanadigan bo‘limlar (lazy chunk) ham birinchi ochilishda keshga tushadi;
 *  - /api/* hech qachon keshlanmaydi (shaxsiy ma’lumot va real vaqt).
 */
const VERSION = "staffora-mini-v2";
const SHELL = "/mini-app";
const MODELS = [
  "/face-models/tiny_face_detector_model-weights_manifest.json",
  "/face-models/face_landmark_68_tiny_model-weights_manifest.json",
  "/face-models/face_recognition_model-weights_manifest.json",
];
const MAX_ASSETS = 160;

/** Sahifa HTML’idagi skript va stillarni topadi (Vite xeshli fayllari). */
function assetsOf(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)) found.add(match[1]);
  return [...found];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        const response = await fetch(SHELL, { cache: "no-store" });
        if (response.ok) {
          const html = await response.clone().text();
          await cache.put(SHELL, response);
          await cache.addAll(assetsOf(html)).catch(() => undefined);
        }
      } catch {
        /* oflayn o‘rnatish — keyingi ochilishda to‘ldiriladi */
      }
      await cache.addAll(MODELS).catch(() => undefined);
      await self.skipWaiting();
    })(),
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

/** Eski xeshli fayllar to‘planib qolmasin — eng eskilari o‘chiriladi. */
async function trim(cache) {
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith("/assets/"));
  if (keys.length > MAX_ASSETS) await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((request) => cache.delete(request)));
}

function networkWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Mini App sahifasi: tarmoq birinchi (yangi versiya), sekin yoki aloqa yo‘q bo‘lsa — kesh.
  if (request.mode === "navigate") {
    if (!url.pathname.startsWith("/mini-app")) return;
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        try {
          const response = await networkWithTimeout(request, 3000);
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              copy.text().then(async (html) => {
                await cache.put(SHELL, new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
                // Yangi versiya fayllarini fonda tayyorlab qo‘yamiz.
                await cache.addAll(assetsOf(html)).catch(() => undefined);
                await trim(cache);
              }),
            );
          }
          return response;
        } catch {
          return (await cache.match(SHELL)) || fetch(request);
        }
      })(),
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
    return;
  }

  // Belgi va rasm (favicon, logotip) — keshdan darhol, fonda yangilanadi.
  if (/\.(svg|png|ico|webp)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});
