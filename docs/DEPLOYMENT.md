# Bridge production deployment runbook

This runbook defines the repository-side production contract without selecting a hosting vendor or inventing operator credentials. Bridge has two deployable pieces: a static Vite frontend and the compiled Node/WebSocket signaling service. TURN is a separate operator-managed service.

## 1. Required operator inputs

Before production deployment, supply:

- final public HTTPS frontend origin
- final public WSS signaling origin/path
- TURN/STUN endpoints and TURN credential strategy
- hosting/runtime provider and region(s)
- monitoring destination and retention policy
- final product name after trademark/domain review

Do not commit durable TURN shared secrets, hosting tokens, TLS private keys, metrics bearer tokens, or vendor API credentials. Store them in the selected platform's secret/configuration system.

## 2. Build and release artifact

A production release must use the committed reviewed lockfiles. From `bridge/`, after the lockfile release gate has been completed:

```sh
npm run verify:release
npm run verify:deployment-config
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run build
npm run build:server
npm run test:e2e
npm run test:e2e:turn
```

Do not replace `npm ci` with `npm install` for a release build and do not generate a new dependency graph during production deployment. Until the genuine registry-generated lockfile pair is committed, Bridge remains in bootstrap validation mode and is not production-release-ready.

The existing `Bridge Deploy` workflow is intentionally manual-only and produces an isolated `bridge-release` artifact. It contains `dist/` for the static frontend, `dist-server/` for the compiled Node 22 signaling runtime, dependency/runtime SBOM material, and `bridge-artifacts.sha256` covering every deployable file. The workflow copies `server/package.json` and the reviewed server lockfile into `dist-server/`, so the signaling artifact has a minimal runtime dependency boundary and starts with plain `node signaling.js`; production does not require the development-only `tsx` loader.

A future provider-specific deploy step should consume these reviewed artifacts rather than rebuilding unrelated projects. It must remain scoped to `bridge/**` and Bridge-specific workflow files.

The static host must serve `bridge/dist` over HTTPS and support SPA navigation/fallback as needed by the chosen platform. It must also apply the policy in `public/_headers` or an equivalent native configuration; see `SECURITY_HEADERS.md`.

Before deployment, verify both artifact trees with `sha256sum --check bridge-artifacts.sha256` as documented in `ARTIFACT_INTEGRITY.md`.

## 3. Frontend production configuration

Set the production signaling URL at build time:

- `VITE_SIGNALING_URL=wss://<chosen-signaling-origin>/signal`

Optional STUN overrides use `VITE_BRIDGE_STUN_URLS`. Production TURN should normally use the server-managed credential path in section 4 rather than a durable `VITE_BRIDGE_TURN_*` credential. Vite-prefixed values are browser-visible configuration, not secrets.

The browser-visible TURN variables remain supported for disposable local/CI fixtures and provider credentials intentionally designed for public browser distribution. `npm run verify:deployment-config` requires the explicit `BRIDGE_TURN_CREDENTIAL_EXPOSURE=browser-safe` acknowledgement when that fallback is selected and rejects configuring it simultaneously with server-managed TURN credentials.

After choosing the signaling origin, narrow the CSP `connect-src` allowance from the generic `wss:` scheme to the exact production WSS origin before release.

## 4. Signaling service

Deploy the compiled `dist-server/` artifact on Node 22. Install only its declared runtime dependencies, then start the declared `node signaling.js` command. The TypeScript `server/signaling.ts` plus `tsx` path remains a development convenience and should not be the production process when the compiled artifact is available.

The service must terminate behind HTTPS/WSS-capable infrastructure and preserve WebSocket upgrades for `/signal`.

Supported server configuration:

- `PORT` — local listen port; default `8787`
- `SESSION_TTL_MS` — ephemeral signaling-session lifetime; default 10 minutes
- `SESSION_CLEANUP_INTERVAL_MS` — expired-session/limiter cleanup cadence; default 30 seconds
- `SIGNAL_ATTACH_TIMEOUT_MS` — absolute deadline for an upgraded WebSocket to successfully create or join a session; default 30 seconds, maximum 5 minutes
- `SIGNAL_HEARTBEAT_INTERVAL_MS` — WebSocket liveness sweep cadence; default 30 seconds, maximum 5 minutes
- `SIGNAL_SHUTDOWN_GRACE_MS` — bounded graceful-drain window; default 5 seconds, maximum 60 seconds
- `MAX_SIGNAL_MESSAGE_BYTES` — maximum WebSocket payload; default 256 KiB
- `MAX_SIGNAL_SESSIONS` — in-process active session cap; default 10,000
- `MAX_SIGNAL_CONNECTIONS` — in-process successfully upgraded WebSocket cap; default 20,000
- `SIGNAL_MESSAGES_PER_MINUTE` — per-connection message limit; default 120
- `SIGNAL_CREATES_PER_10_MINUTES` — per-source create limit; default 20
- `SIGNAL_JOINS_PER_10_MINUTES` — per-source join limit; default 60
- `SIGNAL_ALLOWED_ORIGINS` — comma-separated exact browser origins allowed to upgrade `/signal`; required and HTTPS-only when `NODE_ENV=production`
- `SIGNAL_METRICS_BEARER_TOKEN` — optional server-only bearer secret for `/metrics`; when set, it must be 32-512 non-whitespace characters and metrics requests without the exact bearer credential receive `401`
- `SIGNAL_TURN_URLS` — optional comma-separated TURN URLs sent to authenticated paired browsers; must be configured together with `SIGNAL_TURN_SHARED_SECRET`
- `SIGNAL_TURN_SHARED_SECRET` — server-only 32-512 character shared secret for coturn-compatible TURN REST authentication; never expose through `VITE_*`
- `SIGNAL_TURN_CREDENTIAL_TTL_SECONDS` — temporary TURN credential lifetime; default 900 seconds, maximum 3600 seconds

When `SIGNAL_TURN_URLS` and `SIGNAL_TURN_SHARED_SECRET` are configured, a successful guest join causes signaling to mint a short-lived `expiry:bridge` username and base64 HMAC-SHA1 credential compatible with coturn's shared-secret REST mode. The temporary credential is sent to both paired sockets before `session-joined` / `peer-joined` triggers WebRTC negotiation. Merely creating an unused host session does not mint a TURN credential. The durable shared secret never enters the frontend bundle or signaling protocol.

All numeric values are parsed as positive safe integers at process startup, and `PORT` is additionally restricted to `1..65535`. Invalid, zero, negative, fractional, non-numeric, or out-of-range values fail the process before it begins listening rather than silently weakening capacity/rate-limit controls. Origin, metrics-token, and TURN configuration are also validated at startup. Treat a startup failure as a configuration error and correct the operator-supplied value instead of bypassing validation.

An upgraded signaling socket that never successfully attaches is closed after `SIGNAL_ATTACH_TIMEOUT_MS` with `attachment-timeout`; rejected or malformed traffic does not extend that absolute deadline. In addition, `MAX_SIGNAL_CONNECTIONS` places a process-wide ceiling on successfully upgraded sockets independently of session capacity. Upgrades attempted at the ceiling receive HTTP 503 with `Retry-After: 1` before WebSocket admission, and the rejection increments only the aggregate `server-connection-capacity` error counter. These controls prevent unauthenticated idle upgrades from persisting indefinitely or consuming unbounded concurrent socket resources. They complement rather than replace trusted-edge concurrent-connection limits.

The application deliberately does not trust `X-Forwarded-For`. If deployed behind a reverse proxy, enforce source-address abuse controls at that trusted edge. For multiple signaling replicas, use a shared limiter or equivalent edge policy because the built-in limiters, connection/session capacity, and session registry are process-local. Sticky routing alone is not a substitute for shared abuse controls if sessions may move between replicas.

## 5. Health and observability

- `GET /health` is the liveness endpoint.
- `GET /ready` is the readiness endpoint and returns `503` while the process drains.
- `GET /metrics` exposes aggregate signaling counters/gauges documented in `OBSERVABILITY.md`; when `SIGNAL_METRICS_BEARER_TOKEN` is configured, scrapers must send `Authorization: Bearer <token>`.

Do not expose high-cardinality peer/session identifiers through monitoring. Keep `/metrics` behind trusted operator infrastructure when practical and use the server-only bearer option when the surrounding infrastructure does not already authenticate the scraper. Never place that credential in `VITE_*` configuration or frontend assets. Alert on service unavailability, connection/session capacity pressure, unusual signaling error rates, and sustained changes in relay ratio.

## 6. TURN

Production TURN is required for reliable connectivity across restrictive NAT/firewall environments and for the user-selectable relay-only privacy mode. Follow `TURN.md` for accepted configuration and local CI verification.

The preferred production deployment configures the TURN service for shared-secret REST authentication, stores the shared secret only in TURN/signaling server secret management, and sets `SIGNAL_TURN_URLS` plus `SIGNAL_TURN_SHARED_SECRET` on the Bridge signaling runtime. Bridge then distributes only short-lived derived credentials to browsers after authenticated rendezvous admission.

The operator must still provide production TURN hostname(s), authentication, TLS/certificate handling as appropriate, quotas, abuse protection, capacity monitoring, and secret rotation. Bridge fails closed in relay-only mode when no usable TURN configuration exists.

## 7. Production smoke test

After deployment, validate from two real browser/network contexts:

1. Verify the downloaded `bridge-release` artifact against `bridge-artifacts.sha256` before publishing either component.
2. Load the final HTTPS frontend and confirm security headers/CSP are active.
3. Confirm the deployed signaling runtime reports healthy at `/health`, ready at `/ready`, and is the compiled artifact rather than a development `tsx` process.
4. If metrics bearer authentication is configured, confirm unauthenticated `/metrics` receives `401` and an authorized server-side scrape succeeds without exposing the credential.
5. Create a session and join using the generated Receive Portal QR/link.
6. Confirm both peers reach authenticated `Connected` state.
7. When server-managed TURN is configured, confirm no durable shared secret appears in frontend assets/browser configuration and that paired clients receive temporary credentials with bounded expiry.
8. Send encrypted text and a file; approve the file; verify completion and downloaded bytes.
9. Cancel one offered file before approval and confirm sender/receiver recover cleanly.
10. Confirm direct-vs-relayed status appears and `/metrics` reflects observed routes without identifiers; verify connection/session gauges remain below configured capacity during the smoke test.
11. Test from networks that require TURN, then enable relay-only mode and verify the route is `Relayed`.
12. Install/relaunch the PWA where supported.
13. Perform the remaining manual checks in `ACCESSIBILITY.md`.
14. Confirm no deployment/build job touched `colortrace/**` or `extensible-terminal/**`.

Record browser versions, network classes, signaling/TURN region, and pass/fail results without storing pairing secrets, TURN shared secrets, temporary TURN passwords, metrics credentials, session IDs, filenames containing personal data, or transfer contents.

## 8. Rollback

Keep the previous known-good `bridge-release` artifact and its checksum manifest. Roll back frontend and signaling independently if possible, but verify the retained artifact before deployment. A signaling rollback may invalidate active ephemeral sessions and temporary TURN credentials; this is acceptable, but operators should expect users to re-pair. Do not preserve session/verifier data solely for rollback.

## 9. Release gate

Repository-side release work is complete when genuine registry-generated lockfiles are committed, dependency-backed tests/builds pass in a usable environment, docs/security configuration have final review, and the remaining manual accessibility checks are recorded. Production release additionally requires the external inputs listed in section 1 and a successful production smoke test.
