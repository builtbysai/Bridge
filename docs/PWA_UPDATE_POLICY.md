# Bridge PWA update policy

Bridge's service worker is a production-only cache boundary.

## Why development registration is disabled

Vite development serves source modules from stable, unhashed paths such as `/src/main.ts`. A production service worker must never cache those paths during development because an earlier source response could survive a reload and make local or Playwright validation execute stale code instead of the current working tree.

`src/service-worker-registration.ts` therefore registers `/sw.js` only when `import.meta.env.PROD` is true. Local development and the current Playwright dev-server harness run without a service worker cache.

## Production update freshness

Production registration sets `updateViaCache: "none"`. This tells the browser not to satisfy service-worker update checks from the HTTP cache. `public/_headers` also serves `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate`.

Together these controls keep the worker script on the release control path while still allowing the worker-managed application cache to provide an offline shell.

The worker uses network-first navigation handling. A normal online navigation therefore prefers the deployed HTML and refreshes the cached root shell, while an offline navigation falls back to that cached root response.

## Offline-shell integrity boundary

The install event now fetches `/` explicitly with `cache: "reload"` and `credentials: "same-origin"` instead of delegating shell precaching to `cache.addAll()`. That keeps the initial offline shell on the network/revalidation path even if an intermediary HTTP cache has an older document.

Bridge also requires a successful `200` non-opaque response whose `Content-Type` contains `text/html` before that response can become the offline shell. The same HTML check applies when an online navigation refreshes the cached fallback. A maintenance page, JSON error envelope, proxy diagnostic, or other non-HTML `200` response is returned to the live navigation but is not persisted as Bridge's future offline experience. Installation fails rather than caching an invalid initial shell.

This is intentionally a narrow validation boundary, not content attestation: release artifact hashes and deployment smoke checks remain responsible for proving that the deployed HTML is the expected Bridge release.

## Immutable-only runtime cache

Bridge deliberately limits cache-first runtime storage to same-origin Vite build assets under `/assets/` whose filenames are content hashed. Scripts, styles, images, and fonts in that directory may be cached because a changed build emits a different URL.

Unversioned public resources do **not** enter service-worker Cache Storage. This includes `manifest.webmanifest`, PWA icons under `/icons/`, and other stable public paths. Those resources stay on the normal browser/HTTP-cache path, so changing a manifest or icon does not require a byte change to `sw.js` before clients can observe the deployment.

Generic same-origin fetch/XHR requests are also excluded from the worker cache. Signaling-adjacent health, readiness, metrics, or future API traffic therefore cannot be persisted merely because it shares the frontend origin.

A new worker cache version deletes earlier Bridge shell caches during activation, so clients moving from the previous broader cache policy do not retain its stale runtime entries.

## Release checks

- Production builds must continue to register the worker only in production mode.
- Worker update checks must continue to bypass intermediary HTTP caching.
- Initial offline-shell installation must explicitly revalidate `/` rather than accepting a potentially stale HTTP-cache response.
- Only successful same-origin HTML responses may replace the cached offline shell.
- `/sw.js` must retain the no-cache/no-store response policy in the production header baseline.
- Development and browser-test servers must not be controlled by the production service worker.
- Runtime cache-first handling must remain limited to content-hashed `/assets/` build resources.
- The manifest, icons, generic public files, health/readiness/metrics endpoints, and future API/XHR traffic must not enter service-worker Cache Storage.
- Any future broadening of worker caching must be reviewed for stale-release behavior, offline behavior, storage growth, and whether sensitive/API responses could enter Cache Storage.

Focused unit coverage in `src/service-worker-registration.test.ts` guards the production-only registration boundary, update policy, unsupported-browser behavior, and soft failure semantics. Dependency-free `scripts/service-worker-policy.test.mjs` executes the actual worker source in a mocked service-worker environment and verifies cache-bypassing HTML shell installation, rejection of non-HTML shell responses, unversioned/API bypass, immutable-asset cache-first behavior, and network-first navigation shell refresh.
