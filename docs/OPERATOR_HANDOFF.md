# Bridge production operator handoff

This checklist separates repository-complete work from values that must come from the production operator. It is intentionally provider-neutral and contains no production credentials.

Start from `config/production.env.example`. Copy variable names and replace placeholders only inside the selected hosting providers' environment/secret settings. Do not commit a populated copy.

Before using the template, run `npm run verify:deployment-template`. The production frontend artifact intentionally needs only the public deployment values `BRIDGE_FRONTEND_ORIGIN` and `VITE_SIGNALING_URL`: use `npm run build:production` with those values to build the Vite app, rewrite only the copied `dist/_headers` CSP from the development-safe generic `wss:` allowance to the exact production signaling origin, and validate the generated static artifact. Durable TURN shared secrets and other server-only values are not required by the frontend build and must not be injected into that build merely to satisfy validation.

Validate the complete deployed runtime separately with `npm run verify:deployment-config` in an operator-controlled environment containing the real `SIGNAL_ALLOWED_ORIGINS` and TURN configuration. That full check verifies frontend/signaling origin agreement, exact CSP signaling origin, and TURN credential mode. The source `public/_headers` remains the reviewed local/development baseline and does not need a deployment-specific hostname committed to git.

The manual `Bridge Deploy` workflow asks for the exact frontend origin and signaling URL as non-secret dispatch inputs and uses `npm run build:production`; it therefore emits a frontend artifact whose CSP is already scoped to the selected signaling origin. It still stops at isolated build artifacts until a hosting target and credentials are configured.

## Operator inputs

- [ ] Choose the final HTTPS frontend origin.
- [ ] Choose the final WSS signaling hostname and expose `/signal` through TLS-capable WebSocket infrastructure.
- [ ] Set `SIGNAL_ALLOWED_ORIGINS` to the exact HTTPS frontend origin(s).
- [ ] Provision TURN endpoint(s) compatible with shared-secret REST authentication.
- [ ] Store the durable TURN shared secret only in signaling/TURN server secret management as `SIGNAL_TURN_SHARED_SECRET`.
- [ ] Set `SIGNAL_TURN_URLS` to the production TURN endpoint(s); prefer TLS (`turns:`) where the provider supports it.
- [ ] Decide whether `/metrics` is private/authenticated by platform infrastructure; otherwise create a server-only `SIGNAL_METRICS_BEARER_TOKEN`.
- [ ] Choose hosting/runtime provider and region(s), including trusted-edge connection/rate-limit policy.
- [ ] Choose monitoring/alerting destination and retention policy.
- [ ] Select the final product name after trademark/domain review.

## Repository-to-deployment gates

- [x] Production configuration template is placeholder-only and defaults to server-managed short-lived TURN credentials.
- [x] Dependency-free guard rejects browser-visible TURN credential assignments and committed durable secrets in the template.
- [x] Production deployment preflight validates frontend/signaling origin agreement, exact CSP signaling origin, and TURN credential mode.
- [x] Production frontend artifact validation is separated from server-runtime secret validation, so the static build never needs the durable TURN shared secret.
- [x] Production artifact generation deterministically narrows `dist/_headers` to the exact WSS signaling origin and rejects insecure, loopback, malformed, already-narrowed, missing, or duplicate CSP inputs instead of silently emitting a permissive artifact.
- [x] `npm run build:production` chains frontend build, CSP narrowing, and validation of the generated deployable artifact while leaving the repository baseline header provider-neutral.
- [x] Manual Bridge release artifact generation requires explicit production frontend/signaling values and uses the production-scoped build path rather than the generic development build.
- [x] Signaling runtime validates allowed origins, TURN URLs/shared secret pairing, bounded credential TTL, abuse-control ceilings, graceful shutdown, and optional metrics authentication at startup.
- [ ] Commit genuine registry-generated root and signaling-runtime lockfiles.
- [ ] Run dependency-backed typecheck, unit/integration tests, frontend/server builds, browser e2e, and local-coturn relay validation from the committed lockfiles.
- [ ] Complete the manual accessibility checklist in `ACCESSIBILITY.md`.
- [ ] Run `npm run verify:deployment-config` with the real production signaling allowlist and TURN configuration before publication.
- [ ] Produce and verify the isolated Bridge release artifact and SHA-256 manifest.

## Production smoke test

After deployment, follow `DEPLOYMENT.md` section 7. At minimum, verify health/readiness, origin admission, ephemeral TURN credentials, direct and relayed connections, relay-only mode, encrypted text/file transfer, cancellation, route metrics, PWA relaunch, and the remaining manual accessibility checks from real devices/networks.

Never record pairing secrets, durable or temporary TURN passwords, metrics bearer tokens, private filenames/content, or other production secrets in the smoke-test record.
