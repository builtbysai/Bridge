# Security headers and CSP

Bridge must be served over HTTPS in production. The repository includes `public/_headers` as a deployable baseline for static hosts that support `_headers` files (for example, Cloudflare Pages or Netlify). Other hosting targets must translate the same policy into their native configuration before release.

## Required browser policy

The baseline deliberately keeps application code and assets same-origin and blocks framing, plugins, base-tag rewriting, and referrer leakage:

- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self'; upgrade-insecure-requests`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

`connect-src` permits secure WebSocket origins because the production signaling origin has not been selected yet. Once the final signaling hostname is known, replace the broad `wss:` source with the exact origin. Do not weaken the policy with `unsafe-inline` or `unsafe-eval` to work around deployment mistakes.

WebRTC ICE traffic is not a substitute for CSP enforcement; TURN/STUN endpoints remain configured separately through the application's ICE server configuration.

## Repository guard

`npm run verify:release` parses `public/_headers` and requires the reviewed header values above exactly, rather than only checking that the header names appear somewhere in the file. It also requires the reviewed manifest and service-worker cache directives. This catches accidental policy weakening such as loosening CSP, referrer, framing, permissions, opener/resource isolation, or service-worker update behavior before dependency installation begins.

The production signaling origin is intentionally the one expected future exception: after an operator selects the real secure WebSocket origin, narrow `connect-src` from broad `wss:` to that exact origin and update the reviewed preflight value in the same change. Do not relax any other directive to make a deployment pass.

## HSTS

Enable `Strict-Transport-Security` only after the final production hostname and HTTPS redirect behavior are confirmed. Recommended initial value after validation:

`Strict-Transport-Security: max-age=31536000`

Do not add `includeSubDomains` or preload until the operator has explicitly reviewed the consequences for the whole parent domain.

## Service worker caching

The repository baseline forces `service-worker.js` to revalidate with `no-cache, no-store, must-revalidate` and gives the manifest only a short `public, max-age=3600` cache lifetime. The release preflight enforces both values. Fingerprinted Vite assets may remain long-lived at the hosting layer.

## Release verification

Before production release, verify the deployed response headers with the actual hosting target and confirm:

1. the application loads without CSP violations;
2. signaling connects only to the intended secure WebSocket origin;
3. Bridge cannot be embedded in an iframe;
4. HTTP redirects to HTTPS before application content is served;
5. the service worker can update after a new deployment;
6. no secret from the URL fragment appears in request logs or referrer headers.
