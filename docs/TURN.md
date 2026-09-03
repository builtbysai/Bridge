# TURN configuration and verification

Bridge supports TURN without committing any production relay endpoint or credential. `PeerTransport` loads ICE servers through `src/ice-config.ts`; the browser uses the default public STUN server unless deployment configuration supplies replacements.

## Production credential model

The preferred production path is now server-managed ephemeral TURN credentials. The signaling process can be configured with:

- `SIGNAL_TURN_URLS`: comma-separated `turn:`/`turns:` URLs exposed to paired browsers.
- `SIGNAL_TURN_SHARED_SECRET`: the server-only shared secret used by a compatible TURN REST deployment such as coturn `use-auth-secret` / `static-auth-secret`.
- `SIGNAL_TURN_CREDENTIAL_TTL_SECONDS`: optional temporary-credential lifetime; defaults to 900 seconds and is capped at 3600 seconds.

`SIGNAL_TURN_URLS` and `SIGNAL_TURN_SHARED_SECRET` must be configured together. The shared secret is validated only in the signaling runtime and must be injected through operator-controlled secret management; it must never be committed or exposed as a Vite variable.

After a guest successfully proves the rendezvous verifier and joins an existing Bridge session, signaling derives a temporary TURN username of the form `expiry:bridge` and a base64 HMAC-SHA1 credential using the server-only shared secret. This is the credential construction documented by coturn's TURN REST authentication mode. The temporary bundle is delivered to both already-attached Bridge sockets before WebRTC negotiation begins. Creating an unused session alone does not mint a TURN credential.

The browser validates the signaling-delivered TURN bundle and gives it precedence over static browser TURN values for that session. Because the default Bridge signaling session lifetime is ten minutes and the default TURN credential lifetime is fifteen minutes, normal recovery/restart activity remains within the credential lifetime. When server-managed TURN is enabled, signaling now fails startup unless `SIGNAL_TURN_CREDENTIAL_TTL_SECONDS * 1000 >= SESSION_TTL_MS`; this prevents an operator override from creating a session whose later ICE restart could outlive its relay allocation credential. The one-hour TURN credential ceiling therefore also bounds TURN-enabled session lifetimes unless the implementation is extended to refresh credentials during a live session.

## Browser-visible fallback configuration

The Vite build still accepts these variables for local/CI fixtures and deployments where the provider intentionally supplies browser-safe credentials:

- `VITE_BRIDGE_STUN_URLS`: comma-separated `stun:`/`stuns:` URLs. Optional.
- `VITE_BRIDGE_TURN_URLS`: comma-separated `turn:`/`turns:` URLs. Optional.
- `VITE_BRIDGE_TURN_USERNAME`: TURN username. Required when browser TURN URLs are present.
- `VITE_BRIDGE_TURN_CREDENTIAL`: TURN credential. Required when browser TURN URLs are present.

Malformed schemes and partial TURN credentials fail configuration rather than silently weakening relay-only mode.

Anything prefixed with `VITE_` is part of the client build and must be treated as public browser-visible configuration. Do not put a durable infrastructure secret in these variables. Production validation accepts this fallback only when the operator explicitly sets `BRIDGE_TURN_CREDENTIAL_EXPOSURE=browser-safe`, confirming that disclosure to every frontend user is intentional. The release preflight rejects simultaneous server-managed and browser-visible TURN credential modes to avoid ambiguous deployments.

## Local relay integration test

Bridge CI installs a local coturn instance using test-only values:

- loopback listener/relay addresses
- realm `bridge.test`
- username `bridge-test`
- password `bridge-test-password`

Those values are intentionally non-production and scoped to the disposable CI runner. The Playwright TURN case enables Bridge's persisted relay-only preference on both browser contexts, pairs the browsers through the normal signaling/key-confirmation flow, requires both route indicators to report `Relayed`, and transfers encrypted text over that connection.

Run the relay case locally only after starting a compatible coturn fixture and exporting the matching test variables:

```sh
BRIDGE_E2E_TURN=1 \
VITE_BRIDGE_STUN_URLS='stun:127.0.0.1:3478' \
VITE_BRIDGE_TURN_URLS='turn:127.0.0.1:3478?transport=udp' \
VITE_BRIDGE_TURN_USERNAME='bridge-test' \
VITE_BRIDGE_TURN_CREDENTIAL='bridge-test-password' \
npm run test:e2e:turn
```

The static browser path remains intentionally available for this disposable local fixture; production should prefer the signaling-issued mode above.

## Production checklist

Before release, the operator must supply and verify the real TURN service rather than copying CI values:

- choose TURN hostnames and UDP/TCP/TLS transports appropriate for the deployment;
- configure firewall/NAT rules and a relay port range;
- configure the TURN server for shared-secret REST authentication and inject the same secret into the Bridge signaling runtime, or use an explicitly browser-safe provider credential;
- keep `SIGNAL_TURN_SHARED_SECRET` only in server-side secret management;
- keep the configured TURN credential TTL at least as long as the signaling session TTL; startup rejects shorter values;
- run `npm run verify:deployment-config` with the real production origins/TURN configuration before building the release artifact;
- ensure relay-only mode succeeds from networks where direct peer connectivity is blocked;
- verify Bridge reports `Relayed` from `RTCPeerConnection.getStats()` on the selected pair;
- confirm rate limits, quotas, logs, retention, and abuse response for the relay operator;
- document the TURN operator in the final privacy policy;
- never commit the production TURN shared secret, durable password, or hosting credential.

The repository can validate configuration parsing, ephemeral credential generation, browser parsing/precedence, and the relayed WebRTC path without real production secrets. The final production smoke test remains an operator/deployment task.