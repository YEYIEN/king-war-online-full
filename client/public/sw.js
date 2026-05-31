const CACHE_PREFIX = "king-war-cache-";
const CACHE_NAME = CACHE_PREFIX + "runtime-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // version.json 永遠走網路，避免更新提示被快取
  if (url.pathname === "/version.json") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => {
        return new Response(
          JSON.stringify({
            version: "offline",
            updatedAt: new Date().toISOString()
          }),
          {
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      })
    );
    return;
  }

  // HTML / JS / CSS 採 network first，避免 PWA 長期吃舊版
  if (
    url.pathname === "/" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.startsWith("/assets/")
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });

          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || fetch(request);
        })
    );
  }
});
