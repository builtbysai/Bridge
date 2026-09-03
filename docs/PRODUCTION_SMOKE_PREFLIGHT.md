# Bridge production smoke preflight

Bridge keeps the real two-device production smoke test in `DEPLOYMENT.md`, but several deployment checks are deterministic and do not require pairing secrets, TURN credentials, or operator secrets. `npm run smoke:production` automates that safe subset so production misconfiguration can fail before a human starts the two-network transfer walkthrough.

## Inputs

Run from `bridge/` with the exact deployed public values:

```sh
BRIDGE_FRONTEND_ORIGIN=https://bridge.example.com \
VITE_SIGNALING_URL=wss://signal.example.com/signal \
npm run smoke:production
```

Both values are public deployment coordinates, not secrets. The preflight rejects insecure schemes, loopback hosts, credentials in URLs, query/fragment material, a frontend value that is not an exact HTTPS origin, or a signaling path other than exact `/signal`.

If production `/metrics` is configured to require `SIGNAL_METRICS_BEARER_TOKEN`, also set the non-secret expectation flag:

```sh
BRIDGE_EXPECT_METRICS_AUTH=1 \
BRIDGE_FRONTEND_ORIGIN=https://bridge.example.com \
VITE_SIGNALING_URL=wss://signal.example.com/signal \
npm run smoke:production
```

The preflight never accepts or sends the bearer token. With the flag enabled it only verifies that an unauthenticated metrics request receives `401`, advertises Bearer authentication, and remains `no-store`.

## Automated checks

The command verifies:

- the frontend loads successfully and does not redirect to another origin;
- the production CSP contains the exact configured signaling WSS origin and no longer permits the generic `wss:` source;
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and a non-empty `Permissions-Policy` are present;
- `/manifest.webmanifest` and `/sw.js` load from the same frontend origin and force revalidation through `no-cache` or `max-age=0`;
- signaling `/health` returns HTTP 200, JSON `{ "ok": true }`, and `Cache-Control: no-store`;
- signaling `/ready` returns HTTP 200, JSON `{ "ready": true }`, and `Cache-Control: no-store`;
- when `BRIDGE_EXPECT_METRICS_AUTH=1`, unauthenticated `/metrics` returns HTTP 401 with Bearer authentication advertised and `Cache-Control: no-store`.

Focused dependency-free tests exercise the accepted production contract plus insecure/loopback endpoint rejection, generic WebSocket CSP rejection, draining readiness rejection, and the metrics-auth expectation path.

## What remains manual

Passing this command is necessary but not sufficient for release. The operator still needs the production smoke steps in `DEPLOYMENT.md` that require real browser behavior and infrastructure: two-device pairing, authenticated connection, encrypted text/file transfer, cancellation recovery, direct-versus-relayed reporting, TURN-required network coverage, relay-only mode, PWA install/relaunch, manual accessibility review, and confirmation that no durable TURN or metrics secret appears in browser-visible assets.

Do not add production credentials to this command, its logs, or repository fixtures. It is intentionally limited to public endpoints and unauthenticated deployment behavior.
