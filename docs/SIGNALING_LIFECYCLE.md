# Signaling connection/session lifecycle

Bridge signaling treats one WebSocket connection as belonging to at most one session and one role for the lifetime of that socket.

## Browser origin admission

Production deployments can set `SIGNAL_ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins such as `https://bridge.example.com`. Entries must be complete `http:` or `https:` origins with no path, query string, fragment, or embedded credentials. They are canonicalized and deduplicated during startup; malformed entries fail startup rather than silently widening access.

When the allowlist is non-empty, `/signal` WebSocket upgrades must carry an `Origin` header exactly matching one configured origin. Missing or untrusted origins receive HTTP 403 before WebSocket admission, session creation, verifier processing, or rate-limit accounting. This limits browser-based signaling use to the selected frontend origins and reduces cross-site WebSocket abuse. It is defense in depth: pairing admission, capacity limits, and rate limits remain required.

The allowlist intentionally defaults to empty for local development, CLI-style test clients, and deployments that have not yet selected a production frontend hostname. Before production exposure, operators should configure the exact HTTPS frontend origin or origins. This value is configuration, not a secret, and should be changed together with the deployed frontend origin and CSP `connect-src` narrowing described in `SECURITY_HEADERS.md`.

## Upgrade request parsing

The signaling server uses only the WebSocket request target to decide whether an upgrade is for `/signal`. It does not construct that URL from the inbound `Host` header. `Host` is attacker-controlled at the application boundary and may be syntactically invalid even when the HTTP parser accepts the request; using it as a URL base can make URL parsing throw inside the upgrade event and turn one malformed request into a process-level availability failure.

Bridge therefore resolves the request target against a fixed local base, rejects an unparseable target with HTTP 400, and applies origin admission before `ws` handles the upgrade. Production reverse proxies should still validate hostnames at the edge, but signaling process safety does not depend on that validation.

## Connection admission capacity

The signaling process bounds successfully upgraded WebSocket connections with `MAX_SIGNAL_CONNECTIONS`, defaulting to 20,000. The default intentionally accommodates up to two peers for the default 10,000-session ceiling while still placing an explicit upper bound on upgraded sockets, including sockets that have not attached to a session yet.

Once the process is at connection capacity, a new `/signal` upgrade is rejected before `ws` admission with HTTP 503, `Retry-After: 1`, and `Cache-Control: no-store`. The rejection is recorded only as the bounded aggregate `server-connection-capacity` metric. Closing an admitted socket immediately releases one connection slot.

This complements the attachment deadline. `SIGNAL_ATTACH_TIMEOUT_MS` prevents one unattached socket from living indefinitely; `MAX_SIGNAL_CONNECTIONS` prevents a client population from consuming unbounded concurrent socket resources during that deadline. Both controls are process-local, so production edge infrastructure should still enforce appropriate global/per-source concurrent-connection policy, especially when multiple signaling replicas are used.

## Message validation boundary

Every WebSocket frame must decode as a JSON object before protocol dispatch. Syntactically invalid JSON receives `invalid-json`; valid JSON values that are not objects, including `null`, arrays, strings, numbers, and booleans, receive `invalid-message`.

This check is an availability boundary. JavaScript's `JSON.parse("null")` succeeds, but attempting to read `.type` from the resulting `null` value throws. Without an explicit shape guard, one unauthenticated client could therefore terminate the signaling process with a single valid-JSON frame. Message shape validation happens before any create/join/signal command dispatch and keeps malformed protocol input on the normal bounded error path.

## Attachment deadline

An upgraded WebSocket must successfully create or join a session within `SIGNAL_ATTACH_TIMEOUT_MS` (30 seconds by default, configurable up to 5 minutes). If it remains unattached when the absolute deadline expires, signaling sends `attachment-timeout` and closes the socket with WebSocket policy code `1008`.

The deadline is intentionally absolute: malformed JSON, invalid protocol objects, failed verifier attempts, unknown message types, and other rejected traffic do not reset it. This prevents an unauthenticated client from keeping an otherwise idle upgraded socket alive indefinitely merely by sending junk below the normal per-connection message limit. A successful `create-session` or `join-session` clears the timer for the rest of that socket's attached lifetime.

This is a process-local resource bound, not a substitute for trusted-edge connection limits. Production operators should still enforce sensible concurrent-connection and request controls at the reverse proxy/load balancer, especially for multi-replica deployments.

## Attachment invariant

A connection starts unattached. Its first successful `create-session` attaches it as the host of the newly created session; its first successful `join-session` attaches it as the guest of the requested session. Once attached, any later `create-session` or `join-session` message on the same WebSocket fails with `already-attached`.

This is a resource and authorization boundary, not only a protocol convenience. Allowing a socket to replace its local attachment bookkeeping while remaining present in an older session can leave stale peer membership behind, consume the global session-capacity budget until TTL cleanup, retain obsolete route metrics, and make disconnect cleanup operate on only the most recently attached session.

Clients that need to enter a different session must close the current WebSocket and establish a fresh signaling connection.

## Cleanup behavior

The host is the lifetime owner of an ephemeral signaling session. If the host WebSocket disconnects unexpectedly, signaling closes the complete session immediately with reason `host-disconnected`, notifies and closes any attached guest, and releases the session-capacity entry instead of leaving an orphaned guest/session until TTL expiry. This keeps the session lifetime aligned with the browser that created the rendezvous and prevents disconnected hosts from leaving unusable capacity behind.

If only the guest disconnects, signaling removes the guest role, clears its route observation, and notifies the host with `peer-left`; the host may continue to wait for another guest until the normal session expiry. Host-driven `close-session`, TTL expiry, and server shutdown also close the complete session explicitly.

## Metrics API contract

The signaling process reports current `sessions` and `connections` gauges by passing process-local counts into `SignalingMetrics.snapshot(...)`, while `SignalingMetrics` owns cumulative create/join counters, bounded signaling-error counters, and route observations. Route updates use `reportRoute(...)` and disconnect cleanup uses `removePeer(...)`.

Keeping this contract explicit matters because the metrics layer is part of the signaling build: server call sites and the metrics implementation must use the same API. Final review found and repaired a branch drift where signaling referenced non-existent connection/route metric methods and an incompatible object-form snapshot call; the server now uses the tested metrics API again.

## Rate-limiter API contract

Signaling uses one sliding-window limiter for per-WebSocket message admission and separate source-address limiters for create/join abuse controls. The protocol call sites consume attempts with `consume(key, timestamp)` so a request can use an explicit timestamp, and disconnect cleanup removes per-connection limiter state with `delete(socket)`.

The limiter therefore accepts opaque keys rather than only strings: source-address keys are strings while the connection limiter is keyed directly by the WebSocket object. The legacy `check(key)` method remains as the clock-backed convenience API used by focused unit tests and other callers, while `consume` is the protocol-facing primitive. Final review found a branch drift where `signaling.ts` called `consume` and `delete` but `rate-limit.ts` exposed neither method and typed keys as strings only; that mismatch would fail the production server TypeScript build. The implementation and focused tests now cover both explicit-timestamp consumption and releasing object-keyed connection state.

## Verification

`server/session-attachment.integration.test.ts` starts the real signaling process and verifies that:

- a host cannot create a second session on the same WebSocket;
- the rejected second create does not increase `activeSessions`;
- an attached host cannot subsequently join;
- an attached guest cannot subsequently create;
- an unexpected host disconnect closes the guest with `session-closed` / `host-disconnected` and releases the session immediately; and
- rejected reattachment attempts are visible only as the bounded aggregate `already-attached` error metric.

`server/attachment-timeout.integration.test.ts` verifies that an unattached socket is closed with `attachment-timeout`, rejected traffic cannot extend the deadline, and a successful session attachment clears the deadline so the connected session remains usable.

`server/connection-capacity.integration.test.ts` starts signaling with a two-connection ceiling, occupies both slots, requires the next WebSocket upgrade to receive HTTP 503 plus `Retry-After: 1`, verifies the bounded aggregate `server-connection-capacity` metric, closes one admitted socket, and confirms a replacement connection can then be admitted.

`server/message-shape.integration.test.ts` sends valid JSON values that are not protocol objects (`null`, arrays, strings, numbers, and booleans), requires an `invalid-message` response for each, and confirms `/health` remains available after every rejected frame.

`server/config.test.ts` verifies strict parsing/canonicalization of `SIGNAL_ALLOWED_ORIGINS`, the bounded attachment deadline, and positive-integer `MAX_SIGNAL_CONNECTIONS` configuration, including rejection of zero/fractional values. `server/signaling.integration.test.ts` starts signaling with an allowlist, verifies missing and untrusted origins receive HTTP 403, verifies an explicitly allowed origin can still connect, and sends a raw WebSocket upgrade carrying a deliberately malformed `Host` header to confirm the request is rejected without terminating the signaling process.

`server/rate-limit.test.ts` verifies the protocol-facing `consume(key, timestamp)` behavior, clock-backed `check(key)` compatibility, isolation of string and WebSocket-like object keys, explicit per-connection state deletion, and expiry pruning.

The tests use only local disposable configuration and no production credentials.
