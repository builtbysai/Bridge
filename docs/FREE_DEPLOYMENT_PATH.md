# Bridge low-cost production deployment path

This note turns the provider-neutral deployment contract into a practical low-cost path without committing provider credentials or weakening Bridge's security model.

## Recommended starting topology

For a small public deployment, evaluate this order:

1. **Static frontend: Cloudflare Pages.** Bridge's Vite/PWA output is static and is a natural fit for Pages. Keep the reviewed security headers from `public/_headers`; verify the deployed provider actually emits their equivalents.
2. **Signaling: keep the existing Bridge signaling protocol and security properties.** The current server is a conventional Node/WebSocket process. The lowest-risk first deployment is a host that can run it unchanged. A Cloudflare Workers/Durable Objects port is a viable future cost/operations optimization, but it is an architecture change and must not be treated as configuration-only.
3. **TURN: managed TURN or coturn with REST/shared-secret authentication.** Bridge signaling can now mint coturn-compatible short-lived credentials from a server-only shared secret after a verified guest joins. This removes the need to expose a durable TURN secret in the Vite bundle.
4. **Domain: optional initially.** Provider-generated HTTPS/WSS hostnames are sufficient for a staging/release-candidate deployment. Select a custom domain only after the product-name/trademark decision.

Provider free tiers and limits change. Re-check the provider's current documentation before relying on a quota for production.

## Why not immediately replace signaling with a managed signaling SDK?

Bridge's signaling protocol is deliberately narrow: it handles ephemeral rendezvous while the raw 256-bit pairing secret remains in the browsers, and application-level HMAC key confirmation must succeed before transfer code receives the DataChannel. Replacing that protocol with a third-party signaling SDK would expand the trust/dependency surface and require a fresh threat-model and interoperability review.

A managed signaling service can be evaluated later, but it is not required to get Bridge online cheaply.

## Cloudflare signaling adaptation boundary

Cloudflare Workers and Durable Objects support WebSockets, and Durable Objects are designed for stateful coordination. A Bridge port should use one stateful object per ephemeral rendezvous/session (or an equivalently reviewed design), preserve expiry and capacity behavior, and use the WebSocket hibernation APIs where appropriate.

Do **not** deploy the current in-memory Node server source unchanged as a stateless Worker and assume session state will be durable or consistently colocated. A Cloudflare signaling port is complete only after it has equivalent coverage for:

- create/join verifier admission and raw-secret non-disclosure;
- exact production Origin enforcement;
- session TTL and host-disconnect cleanup;
- payload, connection, source and capacity abuse limits;
- unattached-socket timeout and liveness handling;
- graceful/release-safe behavior during deployment changes;
- low-cardinality metrics without pairing/session/transfer metadata;
- temporary TURN credential issuance when the selected relay uses shared-secret authentication;
- two-browser encrypted transfer and relay-only e2e verification.

Until that port exists and passes those gates, the production contract remains the existing Node signaling service.

## TURN credential rule

Bridge must never put a durable TURN account secret, TURN REST API secret, or equivalent privileged credential in the static Vite bundle. Anything exposed through `VITE_*` is browser-visible.

The preferred production path is now built into the existing signaling service:

```text
SIGNAL_TURN_URLS=turn:relay.example.com:3478?transport=udp,turns:relay.example.com:5349?transport=tcp
SIGNAL_TURN_SHARED_SECRET=<operator secret, server-side only>
SIGNAL_TURN_CREDENTIAL_TTL_SECONDS=900
```

These are runtime settings for the signaling server, not frontend build values. After the guest successfully proves the pairing verifier and joins a session, signaling generates a temporary `expiry:bridge` username and HMAC-SHA1 password compatible with coturn's TURN REST/shared-secret mode, then sends that temporary bundle to both paired browsers before WebRTC negotiation. An unused host-created session does not receive TURN credentials.

The legacy `VITE_BRIDGE_TURN_*` path remains available for disposable local tests and provider credentials that are explicitly intended to be public. Production validation requires `BRIDGE_TURN_CREDENTIAL_EXPOSURE=browser-safe` for that fallback and rejects configuring it at the same time as `SIGNAL_TURN_*`.

Relay-only privacy mode continues to fail closed if neither signaling-issued nor browser-configured TURN is usable.

## Production configuration preflight

Before a real production build, set the operator-owned deployment values and run:

```sh
npm run verify:deployment-config
```

The dependency-free preflight checks the configuration relationships that are easy to get wrong during first deployment without printing configured credentials. It requires:

- `BRIDGE_FRONTEND_ORIGIN` as an exact non-loopback HTTPS origin;
- `VITE_SIGNALING_URL` as an exact non-loopback `wss://.../signal` URL;
- `SIGNAL_ALLOWED_ORIGINS` to contain the frontend origin exactly;
- either server-managed `SIGNAL_TURN_URLS` + `SIGNAL_TURN_SHARED_SECRET`, or the explicitly browser-safe `VITE_BRIDGE_TURN_*` fallback;
- server-managed TURN credential TTL, when overridden, to remain within the reviewed 1..3600 second range;
- `public/_headers` CSP to contain the exact production WSS origin and no longer contain the generic `wss:` allowance.

The preflight rejects simultaneous server-managed and browser-visible TURN modes so an operator cannot accidentally leave an old public credential path active while introducing a privileged server-side secret.

## Staging setup checklist

- [ ] Create a static frontend project and deploy the Bridge build over HTTPS.
- [ ] Deploy the existing Node signaling service on a WSS-capable host, or complete and validate an equivalent reviewed signaling port.
- [ ] Set `SIGNAL_ALLOWED_ORIGINS` to the exact deployed frontend origin.
- [ ] Set the frontend `VITE_SIGNALING_URL` to the exact secure `/signal` endpoint.
- [ ] Narrow CSP `connect-src` from the temporary generic `wss:` allowance to the exact production signaling origin.
- [ ] Provision TURN without committing credentials. Prefer shared-secret REST authentication and inject only `SIGNAL_TURN_SHARED_SECRET` into the signaling runtime.
- [ ] Run `npm run verify:deployment-config` with the final production origins/TURN configuration.
- [ ] Verify direct transfer on two real devices.
- [ ] Verify relay-only transfer on two real devices/networks.
- [ ] Verify `/health`, `/ready`, metrics access policy, graceful shutdown and rollback.
- [ ] Verify deployed security headers.
- [ ] Run the production smoke test in `DEPLOYMENT.md`.

## Current free-tier facts to re-check at deployment time

As of the repository review in September 2026, Cloudflare documents free static Pages requests and a 500-build/month Pages free limit. Cloudflare Workers documents a 100,000-request/day free limit; Durable Objects are available on the free plan with separate usage limits. Metered/Open Relay has advertised a free TURN allowance.

These are planning inputs, not availability guarantees or Bridge requirements. Bridge should remain portable to another standards-compatible static host, Node/WebSocket host and TURN provider.

## Decision for the current release

Do not block V1 on a Cloudflare signaling rewrite. First finish reproducible dependency validation and deploy the existing protocol with the simplest suitable Node/WebSocket host plus a TURN service compatible with Bridge's temporary-credential path. Treat Cloudflare Durable Objects signaling as a post-V1 infrastructure optimization unless the operator explicitly chooses it as the production target before release.
