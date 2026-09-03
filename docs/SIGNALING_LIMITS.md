# Signaling configuration ceilings

Bridge treats signaling resource and rate controls as security boundaries, not arbitrary tuning knobs. The runtime therefore validates both a positive minimum and a reviewed hard maximum at startup. This prevents an accidental extreme-but-syntactically-valid environment value from silently disabling the intended abuse controls or creating an unreasonable single-process resource target.

| Setting | Default | Maximum |
| --- | ---: | ---: |
| `SESSION_TTL_MS` | 600,000 (10 min) | 86,400,000 (24 h) |
| `SESSION_CLEANUP_INTERVAL_MS` | 30,000 (30 s) | 300,000 (5 min) |
| `SIGNAL_ATTACH_TIMEOUT_MS` | 30,000 (30 s) | 300,000 (5 min) |
| `SIGNAL_HEARTBEAT_INTERVAL_MS` | 30,000 (30 s) | 300,000 (5 min) |
| `SIGNAL_SHUTDOWN_GRACE_MS` | 5,000 (5 s) | 60,000 (60 s) |
| `MAX_SIGNAL_MESSAGE_BYTES` | 262,144 (256 KiB) | 1,048,576 (1 MiB) |
| `MAX_SIGNAL_SESSIONS` | 10,000 | 100,000 |
| `MAX_SIGNAL_CONNECTIONS` | 20,000 | 200,000 |
| `SIGNAL_MESSAGES_PER_MINUTE` | 120 | 10,000 |
| `SIGNAL_CREATES_PER_10_MINUTES` | 20 | 1,000 |
| `SIGNAL_JOINS_PER_10_MINUTES` | 60 | 5,000 |
| `PORT` | 8787 | 65,535 |

The heartbeat is a server-side liveness/resource bound. Each open signaling WebSocket is pinged on the configured interval; if it does not acknowledge before the next sweep, Bridge terminates it and lets the normal close path release connection/session state. A synchronous socket `ping()` or `terminate()` failure is contained inside the heartbeat sweep: ping failure is treated as a dead transport and teardown failures are swallowed after cleanup state is released, so an individual socket race cannot escape the timer callback and crash the signaling process.

Signaling WebSocket writes and teardown are also guarded against synchronous transport races. JSON sends first require an open socket and contain a send failure if the transport changes state before `send()` completes. Session cleanup, attachment-timeout closure, graceful shutdown closure, heartbeat termination, and forced shutdown termination use best-effort close/terminate helpers that never let one broken peer escape cleanup and terminate the signaling process. These guards do not hide protocol failures from clients; they only contain transport-level exceptions after the server has already decided what protocol action to take.

The maxima are fail-closed configuration guardrails, not production sizing recommendations. Operators should normally stay near the reviewed defaults and enforce lower per-instance or trusted-edge limits when their deployment capacity requires it. Multi-replica deployments still need shared or edge-enforced abuse controls because Bridge's built-in sessions, connection counts, and rate limiters are process-local.

Values above these ceilings, as well as zero, negative, fractional, non-numeric, or unsafe integer values, cause startup to fail before the signaling server listens. Do not raise the hard ceilings simply to suppress a startup error; review capacity, threat-model implications, and tests together when a larger bound is genuinely needed.
