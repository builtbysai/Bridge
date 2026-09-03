# Bridge delivery plan

## Definition of done

Bridge is considered complete when two browsers can pair, establish a WebRTC DataChannel, send text and files with progress/cancel/integrity verification, fall back through TURN when direct connectivity fails, expose direct-vs-relayed status, support receiver-initiated requests and a guest receive portal, ship as an installable PWA, and pass automated unit/e2e checks.

## Phase 0 — repository and product foundation
- [x] Create isolated `bridge/` project folder
- [x] Define product thesis and architecture
- [x] Add path-filtered CI/deploy workflows
- [ ] Select final product name after trademark/domain review

## Phase 1 — transport proof
- [x] Vite/TypeScript app shell
- [x] Signaling protocol and WebSocket client
- [x] WebRTC peer lifecycle
- [ ] Production TURN credentials/configuration (repository configuration and local relay verification exist; operator endpoint/credentials remain external)
- [x] QR/link pairing
- [x] Text/link/clipboard payload transfer
- [x] Binary chunk protocol
- [x] Progress and cancellation primitives
- [x] SHA-256 end-to-end verification
- [x] Direct/relay connection detection

## Phase 2 — product UX
- [x] Basic Send-file flow
- [x] Receiver-initiated Request flow for file/text/link/clipboard
- [x] Dedicated guest Receive Portal
- [x] Multi-file transfer queue
  - [x] Serial queue model with queued/sending/completed/failed/cancelled states, per-item progress, cancellation, and failure isolation
  - [x] Visible queue with per-item state/progress, queued-item removal, active cancellation, and finished-item cleanup
- [x] Drag-and-drop
  - [x] Drop-file extraction helper
  - [x] Visible keyboard-accessible drop target that enqueues dropped files
- [x] Clipboard/text/link receive cards
- [x] Incoming transfer approval
- [x] Device naming
- [x] Responsive mobile/desktop shell

## Phase 3 — resilience and security
- [x] Application-level session key from QR pairing
- [x] AES-GCM chunk envelope
- [x] Application-level key confirmation bound to the paired session
  - [x] Raw 256-bit pairing secret stays in browsers; signaling receives only a SHA-256 rendezvous verifier
  - [x] Session/role-bound HMAC proof must verify before a DataChannel is exposed to transfer code
  - [x] Replacement DataChannels repeat key confirmation after recovery
- [ ] Typed-code rendezvous with strict expiry/rate limiting
  - [x] Signaling create/join abuse controls: per-connection message limits, source-address create/join limits, payload ceiling, and global session capacity
  - [x] Typed-code security policy: a future human code is rendezvous-only and must not replace PAKE/high-entropy peer authentication
  - [ ] Implement a human-typed rendezvous flow only with an approved PAKE/equivalent authentication design
- [x] Bounded reconnect state machine with exponential backoff and host ICE restart
- [x] Application-level interruption resume negotiation from the receiver's verified next chunk boundary
- [x] Resume across replacement DataChannels while preserving receiver sink/hash/progress state
- [x] Wake Lock during active transfer when available
- [x] Memory-safe transfer core: sender reads files chunk-by-chunk; receiver supports pluggable streaming sinks with incremental SHA-256 verification
- [x] Explicit user-gesture receive flow for File System Access direct-to-disk streaming, with memory fallback for unsupported browsers
- [x] Receiver-side corruption/order failures abort the sink and propagate cancellation to the sender
- [x] Production CSP/security-header baseline and deployment guidance (`public/_headers`, `docs/SECURITY_HEADERS.md`)
- [x] User-facing relay-only privacy control that forces `iceTransportPolicy: "relay"` and fails closed without usable TURN
- [x] Active cancellation while a transfer is waiting for recipient acceptance
  - [x] Expose a synchronous outbound transfer handle (`transferId`, `completion`, `cancel`) before hashing/recipient acceptance
  - [x] Transfer engine honours cancellation during hashing and while waiting for acceptance
  - [x] Wire the queue runner's active `AbortSignal` to the handle and expose the active Cancel control in the queue UI

## Phase 4 — productionization
- [x] PWA manifest/service worker
- [ ] Accessibility audit (`docs/ACCESSIBILITY.md`; automated axe/Playwright baseline is complete, manual keyboard/assistive-tech/contrast/zoom verification remains)
- [x] Browser compatibility matrix
- [x] Unit tests beyond protocol baseline (encrypted payload, request round-trip, streamed sink, direct-to-disk completion, reconnect controller, rejection, corruption, out-of-order, replacement-channel resume, Receive Portal URL coverage, transfer-queue sequencing/cancellation/failure coverage, pairing verifier/key-confirmation proof coverage, signaling rate-limiter coverage, relay-only preference coverage, cancellable outbound-handle coverage, device-name normalization/storage/fallback coverage, ICE/TURN configuration validation)
- [x] Playwright two-peer e2e tests
  - [x] Playwright Chromium harness with host/Receive Portal accessibility smoke checks, keyboard focus regression coverage, and narrow-viewport overflow check
  - [x] Local signaling + two-browser pairing + authenticated encrypted text transfer through the Receive Portal
  - [x] Two-browser file transfer/queue path with recipient approval, serial queue state/progress assertions, downloaded-byte integrity verification, and active cancellation while awaiting approval
- [x] TURN integration test path
  - [x] Validated browser ICE configuration from deployment environment without committed production endpoints/credentials
  - [x] Manual CI provisions disposable local coturn with test-only credentials
  - [x] Relay-only Playwright case requires both peers to report a relayed route and transfers encrypted text
- [x] Threat model (`docs/THREAT_MODEL.md`)
- [x] Privacy model/policy draft (`docs/PRIVACY.md`; production operator details remain deployment-specific)
- [x] Deployment docs (`docs/DEPLOYMENT.md`; provider-neutral build/configuration, signaling, TURN, smoke-test, rollback, and release-gate runbook)
- [x] Observability for signaling errors and direct/relay ratio (`docs/OBSERVABILITY.md`; aggregate JSON metrics expose bounded error counters and live route gauges without session/peer identifiers)
- [ ] Production deployment

## Phase 5 — optional differentiators
- [ ] Saved trusted devices
- [x] Privacy relay-only mode
- [ ] Offline QR signaling over reachable LAN
- [ ] Share Target integration
- [ ] CLI companion
- [ ] Folder transfer

## Current implementation notes

The browser creates or joins ephemeral signaling sessions, negotiates a WebRTC DataChannel, derives an application encryption key from the QR pairing secret with HKDF-SHA-256, encrypts chunks with AES-256-GCM, verifies completed payloads with SHA-256, reports whether the selected ICE route is direct or relayed, and supports sender-initiated file transfer plus receiver-initiated requests for files, text, links, and clipboard text. Text-like payloads render in an in-app receive card with one-click copy.

Pairing is split into a low-sensitivity rendezvous credential and a high-entropy application secret. The raw 256-bit QR fragment secret is never sent to the signaling service. Browsers send a SHA-256 verifier for create/join admission. Once WebRTC opens a DataChannel, each side proves possession of the raw secret with an HMAC-SHA-256 proof derived through HKDF and bound to the session ID plus the explicit host/guest role. Bridge does not report the session connected or hand the channel to `TransferEngine` until the expected remote proof verifies. Wrong-key, wrong-session, wrong-role, malformed, and timeout cases fail closed. Recovered/replacement DataChannels repeat this confirmation before resume state can flow.

The signaling service now has repository-side abuse controls suitable for a single instance: a 256 KiB WebSocket payload ceiling, 120 messages/minute per connection, 20 session creates/10 minutes per source address, 60 joins/10 minutes per source address, a 10,000-session global cap, strict session-ID parsing, and periodic limiter cleanup. These defaults are configurable through environment variables. The service deliberately does not trust `X-Forwarded-For`; a multi-replica or reverse-proxy production deployment must enforce equivalent limits at a trusted edge or use a shared limiter. Typed human codes remain unimplemented because a short code must not become the encryption/authentication secret; any future implementation requires a PAKE or equivalent high-entropy authenticated design.

Signaling observability is aggregate and low-cardinality. `/metrics` reports uptime, active connections/sessions, cumulative create/join counts, bounded signaling-error counters, and live direct/relayed peer-route gauges plus relay ratio. Browser route reporting is best-effort and accepted only from sockets already attached to a session. Connection/session identifiers, verifier material, source addresses, SDP/ICE payloads, filenames, transfer contents, and browser-local names are not exported. Production operators can scrape or translate the JSON into their monitoring backend and should restrict the metrics endpoint at trusted infrastructure when practical.

The host can copy a dedicated Receive Portal URL. Guests opening it see a restricted sender surface with File, Text, Link, and Clipboard actions instead of the normal Bridge dashboard or request controls. Receive Portal pages reject unsolicited inbound transfer offers, while still allowing the paired host to request content through the existing request protocol.

The multi-file sender UX is connected end to end. File selection accepts multiple files on both the normal sender and Receive Portal, and a visible drop target accepts drag/drop plus keyboard activation. Files enter the serial `TransferQueue`, which keeps one file active at a time and renders queued/sending/completed/failed/cancelled states, per-file progress/speed, queued-item removal, active cancellation, and finished-item cleanup. `TransferEngine.startFileTransfer()` returns the outbound transfer ID synchronously together with completion/cancel controls. The queue runner now binds its active `AbortSignal` to that handle, so cancelling the visible active row stops hashing, recipient-approval wait, or transmission through the same engine cancellation path.

Device naming is implemented as an optional browser-local preference. Names are normalized, bounded to 48 characters, stored only in local browser storage, and fall back to a coarse device-class label such as `This Mac` or `This Android phone`. The rename disclosure is keyboard/focus friendly and announces successful changes. Device labels are intentionally not sent through signaling or the transfer protocol, avoiding creation of a new stable rendezvous identifier; future peer-visible names should be sent only after the authenticated encrypted channel is established.

Large-file handling no longer requires the sender to materialize a complete file in memory. Files are hashed incrementally and read in bounded chunks for encryption/transmission. The receiver writes decrypted chunks through a pluggable `ReceiveSink` and verifies them with incremental SHA-256. Browsers with File System Access support can stream directly to a user-selected file; unsupported browsers retain the memory fallback.

Connection interruption is handled by bounded recovery with ICE restart and replacement DataChannels. Transfer resume asks the receiver for its next verified chunk index and continues from that boundary. Completion acknowledgement prevents needless retransmission when the final acknowledgement alone was lost.

Bridge is installable as a PWA and uses Screen Wake Lock during active transfers when available. `docs/BROWSER_COMPATIBILITY.md`, `docs/THREAT_MODEL.md`, `docs/PRIVACY.md`, `docs/SECURITY_HEADERS.md`, `docs/ACCESSIBILITY.md`, `docs/TURN.md`, `docs/OBSERVABILITY.md`, and `docs/DEPLOYMENT.md` define progressive enhancement, security boundaries, privacy claims, production browser-policy baseline, accessibility checks, TURN configuration/verification, aggregate monitoring guidance, and the provider-neutral production runbook. `public/_headers` carries the browser-policy baseline into static builds; the final hosting target must either honor it or translate it into equivalent native configuration. The CSP intentionally permits secure WebSocket origins until a production signaling hostname is selected, at which point it should be narrowed to that exact origin.

TURN is now wired through a validated browser configuration boundary. STUN/TURN URL schemes are checked, TURN URLs require explicit username and credential values, and missing configuration never causes relay-only mode to downgrade to direct connectivity. Because Vite-exposed values are browser-visible, durable production relay shared secrets must not be embedded in the static frontend. The manual CI path provisions disposable loopback coturn credentials and runs a relay-only Playwright case that requires both peers to report `Relayed` before transferring encrypted text. Production TURN hostnames, credentials, quotas, and operator policy remain external deployment inputs.

The Playwright harness starts both the local Vite frontend and Bridge signaling service. Chromium browser checks run axe against the host shell and Receive Portal for serious/critical WCAG A/AA violations, exercise keyboard opening/saving/focus restoration for device naming, and guard against page-level horizontal overflow at 320px. Two-context e2e coverage deterministically seeds only the host's first 32-byte pairing-secret generation inside the test browser, obtains the real signaling session ID from the host UI, opens a Receive Portal with the matching fragment secret, waits for application-level key confirmation on both peers, and exercises authenticated encrypted text plus real file transfers. The file path selects two files together, verifies serial queued/sending/completed state, requires explicit recipient approval, checks completed progress, and compares the browser-downloaded bytes with the original payloads after Bridge's SHA-256 integrity gate. A separate cancellation case cancels the active row after the receiver sees the offer but before acceptance. No production test hook or external secret is introduced.

Relay-only privacy mode is exposed as a persisted browser preference. When enabled, new peer connections use `iceTransportPolicy: "relay"`; Bridge does not silently downgrade to direct connectivity. Without a usable configured TURN server, relay-only sessions therefore fail to connect. This reduces direct peer IP exposure but does not provide anonymity and shifts network metadata visibility to the TURN operator.

The provider-neutral deployment runbook defines the static artifact and signaling runtime contract, environment/configuration boundary, edge rate-limit responsibility, metrics handling, TURN dependency, production smoke-test procedure, rollback behavior, and release gate. Provider-specific hosting/TLS/TURN values remain intentionally external and must be supplied through operator-controlled configuration rather than committed to the repository.

Bridge CI and Bridge Deploy remain manual-only to prevent repeated pre-run GitHub Actions failures from generating notification noise. Full dependency-backed Vitest/build/Playwright execution is still unavailable in the automation environment, so repository-side tests are added without claiming an executed full-suite pass.

## Workstream order

Transport correctness comes before UI polish. Security controls now include signaling abuse limits, application key confirmation, production CSP/security-header guidance, relay-only privacy mode, and end-to-end active queue cancellation. Device naming, the automated accessibility baseline, browser-level two-peer text/file/queue/cancellation coverage, local TURN relay integration, aggregate signaling observability, and the provider-neutral deployment/runbook documentation are complete. The remaining repository-side priorities are the manual accessibility review and final repository-side review; production deployment itself still requires external hosting/TURN/operator inputs. External TURN/hosting credentials remain explicitly out of repository scope.
