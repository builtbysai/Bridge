# Bridge signaling observability

Bridge exposes low-cardinality, aggregate runtime observability from the signaling service without exporting pairing material, session IDs, filenames, message payloads, peer IP addresses, or browser-local device names.

## Endpoints

- `GET /health` is the process liveness endpoint. It returns `200` with `{ "ok": true }` while the process can answer HTTP, including during graceful drain.
- `GET /ready` is the traffic-readiness endpoint. It returns `200` with `{ "ready": true }` during normal operation and switches to `503` with `{ "ready": false, "reason": "shutting-down" }` as soon as SIGTERM/SIGINT drain begins. New WebSocket upgrades are rejected during the same drain window.
- `GET /metrics` returns JSON with process uptime, active WebSocket connections, active sessions, cumulative sessions created/joined, aggregate signaling error counts by bounded error code, and the currently observed direct/relayed peer-route split. When the server-only `SIGNAL_METRICS_BEARER_TOKEN` environment variable is configured, this endpoint requires `Authorization: Bearer <token>` and otherwise responds with `401`; `/health` and `/ready` stay unauthenticated for platform probes.

Example shape:

```json
{
  "uptimeSeconds": 300,
  "connections": 12,
  "sessions": 5,
  "sessionsCreated": 123,
  "sessionsJoined": 118,
  "signalingErrors": {
    "peer-not-ready": 2,
    "rate-limited": 1
  },
  "routes": {
    "direct": 8,
    "relayed": 2,
    "observedPeers": 10,
    "relayRatio": 0.2
  }
}
```

`relayRatio` is `null` until at least one connected browser has reported a selected ICE route. Route reports are accepted only from sockets already attached to a signaling session. The service keeps only each active connection's latest `direct` or `relayed` value and removes it on disconnect, so the route fields are live gauges rather than historical per-peer records.

## Privacy boundary

The metrics surface is intentionally aggregate. Do not add labels or fields containing session IDs, pairing verifiers/secrets, SDP/ICE payloads, source addresses, filenames, transfer sizes, clipboard contents, user-entered device names, or other peer-identifying values. Error codes must remain a bounded application-defined vocabulary rather than embedding arbitrary exception text.

Browser route reporting is best-effort. Failure to report metrics must never fail or downgrade an otherwise valid peer connection.

## Metrics access control

`SIGNAL_METRICS_BEARER_TOKEN` is optional so local development and deployments that already isolate `/metrics` at a private trusted edge can continue to poll the endpoint without an application credential. When set, Bridge validates it at startup as 32-512 non-whitespace characters and compares supplied bearer credentials without an early-exit content comparison. Missing or incorrect credentials receive `401`, `Cache-Control: no-store`, and `WWW-Authenticate: Bearer`; the token is never included in metrics output or browser configuration.

Treat this value as a server-only operator secret. Generate and inject it through the deployment platform's secret-management facility; never place it in `VITE_*` variables, static frontend assets, source control, issue text, or logs. Bridge intentionally ships no production value.

## Production integration

The repository does not assume a specific metrics vendor. A production operator can scrape/poll `/metrics` and translate the JSON into its monitoring system. At minimum, alert or dashboard:

- signaling process liveness/readiness and restart frequency
- active sessions/connections versus configured capacity
- `rate-limited`, `server-capacity`, `unauthorized`, and malformed-message error trends
- relay ratio and observed-peer count
- a sustained increase in relay ratio, which can indicate NAT/network changes or direct-connectivity regressions

Configure the platform/load balancer to use `/ready` for traffic admission and `/health` for liveness. On termination, Bridge marks readiness false before closing sessions and rejecting new upgrades. `SIGNAL_SHUTDOWN_GRACE_MS` controls the bounded drain window (default 5 seconds, maximum 60 seconds); after that window any remaining WebSockets are terminated so shutdown cannot hang indefinitely.

Because `/metrics` is not needed by browsers, production deployments should keep it off the public browser path whenever practical. Prefer a private network/trusted reverse-proxy boundary and, when that boundary does not already authenticate the scraper, configure `SIGNAL_METRICS_BEARER_TOKEN` as a server-only secret. Do not add a static frontend-visible metrics credential.

For multi-replica signaling, each instance currently reports its own in-memory counters/gauges. Aggregate them in the monitoring backend. The same deployment must also provide shared or trusted-edge abuse controls as described in the threat model; this metrics endpoint is not a substitute for distributed rate limiting.
