const CACHE_PREFIX = "bridge-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const APP_SHELL = "/";
const IMMUTABLE_ASSET_PREFIX = "/assets/";
const MAX_RUNTIME_ENTRIES = 64;
const CACHEABLE_DESTINATIONS = new Set(["script", "style", "image", "font"]);

const isAppShellRequest = request => {
  const url = typeof request === "string" ? new URL(request, self.location.origin) : new URL(request.url);
  return url.pathname === APP_SHELL;
};

const isImmutableBuildAssetRequest = request => {
  const url = new URL(request.url);
  return url.origin === self.location.origin
    && url.pathname.startsWith(IMMUTABLE_ASSET_PREFIX)
    && CACHEABLE_DESTINATIONS.has(request.destination);
};

const isCacheableShellResponse = response => {
  if (!response || response.status !== 200 || response.type === "opaque") return false;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/html");
};

const trimRuntimeEntries = async cache => {
  const keys = await cache.keys();
  const runtime = keys.filter(request => !isAppShellRequest(request));
  const excess = runtime.length - MAX_RUNTIME_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(runtime.slice(0, excess).map(request => cache.delete(request)));
};

const storeRuntimeAsset = async (request, response) => {
  if (!response || response.status !== 200 || response.type === "opaque") return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
  await trimRuntimeEntries(cache);
};

const refreshAppShell = async () => {
  const shellUrl = new URL(APP_SHELL, self.location.origin);
  const request = new Request(shellUrl, { cache: "reload", credentials: "same-origin" });
  const response = await fetch(request);
  if (!isCacheableShellResponse(response)) {
    throw new TypeError("Bridge app shell response is not cacheable HTML");
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.put(APP_SHELL, response.clone());
  return response;
};

self.addEventListener("install", event => {
  event.waitUntil(
    refreshAppShell().then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (isCacheableShellResponse(response)) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_SHELL, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(APP_SHELL)) || Response.error();
      }
    })());
    return;
  }

  // Cache only Vite's content-hashed build assets. Unversioned public resources
  // such as the manifest and icons must stay on the normal HTTP-cache path so
  // a deployment cannot leave them stale indefinitely when sw.js is unchanged.
  // Generic same-origin fetch/XHR/API traffic is likewise never persisted.
  if (!isImmutableBuildAssetRequest(event.request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    const response = await fetch(event.request);
    await storeRuntimeAsset(event.request, response.clone());
    return response;
  })());
});
