# Bridge threat model

## Security goals

Bridge is designed for short-lived browser-to-browser transfers between people or devices that intentionally pair for a session. The security goals are:

- keep transfer payloads confidential from the signaling service and passive network observers;
- detect tampering or corruption before a received payload is treated as complete;
- require possession of the high-entropy pairing secret before a peer can join a QR/link session and before a DataChannel is trusted;
- minimize durable server-side state and avoid storing transfer payloads on the signaling service;
- make direct-versus-relayed routing visible without claiming that WebRTC hides network metadata;
- fail closed when authentication, integrity verification, or transfer ordering fails.

Bridge does **not** claim anonymity, secure deletion, metadata invisibility, protection from a compromised endpoint, or protection after a user intentionally shares a pairing link/secret with an attacker.

## Assets

The primary assets are transfer payloads, the per-session pairing secret, derived application encryption keys, session identifiers, filenames/content metadata, and peer/network metadata exposed by WebRTC/signaling.

## Trust boundaries

### Browser endpoints

The two paired browsers are trusted to execute the Bridge client faithfully. A compromised browser profile, malicious extension, injected script, operating-system malware, screen recorder, clipboard monitor, or hostile local user is outside Bridge's cryptographic protection.

### Signaling service

The signaling service is treated as untrusted for payload confidentiality and peer authentication. It forwards WebRTC negotiation messages and keeps short-lived session state, but it must never receive transfer payload bytes or the raw 256-bit QR pairing secret. The browser derives a SHA-256 rendezvous verifier from that secret and sends only the verifier for create/join admission.

A malicious or compromised signaling service can still deny service, delay messages, observe session timing/IP metadata at the HTTP/WebSocket layer, and attempt signaling substitution. It cannot complete Bridge's DataChannel key-confirmation handshake without the raw pairing secret: both peers exchange HMAC-SHA-256 proofs derived with HKDF, bound to the session identifier and the explicit host/guest role. Transfer controls are not exposed to the application until the remote proof verifies. Replacement DataChannels after recovery repeat the same confirmation step.

The rendezvous verifier itself is still an admission credential for the signaling session. TLS/WSS remains required in production so a passive network observer cannot steal it and occupy the guest slot or disrupt the session. The verifier is deliberately separated from the raw secret so possession of signaling state alone is insufficient to forge the application-level peer confirmation or derive the transfer encryption key.

Repository-side denial-of-service controls now bound signaling work on a single instance: WebSocket payloads are capped at 256 KiB, each connection is limited to 120 messages/minute, source addresses are limited to 20 session creates and 60 joins per 10 minutes, the process caps active sessions at 10,000 and upgraded WebSockets at 20,000, and unattached sockets have a bounded absolute attachment deadline. The limits are configurable only within reviewed hard maxima and expired limiter entries are pruned with session cleanup. The application deliberately ignores `X-Forwarded-For` because blindly trusting it would make spoofing trivial; production reverse proxies or multi-replica deployments must enforce equivalent rate limits at a trusted edge or use a shared limiter.

### STUN/TURN

STUN can observe network metadata needed for NAT traversal. A TURN server relays WebRTC traffic when a direct path cannot be established and can observe connection metadata and encrypted packet sizes/timing, but DataChannel traffic remains protected by WebRTC DTLS and Bridge's application encryption. TURN availability is external production infrastructure and credentials must never be committed to this repository.

## Pairing model

QR/link pairing uses a randomly generated 256-bit secret placed in the URL fragment. URL fragments are not sent in normal HTTP requests, which reduces accidental disclosure to the web server, but the secret can still leak through screenshots, clipboard history, browser extensions, screen sharing, or a user forwarding the full URL.

The signaling server stores only the browser-derived 32-byte SHA-256 rendezvous verifier and compares join attempts using a timing-safe comparison. It never receives the raw pairing secret. Sessions have a short TTL and capacity is limited to the expected peers. The public rendezvous ID is a 12-hex-character random identifier for compact pairing URLs, not an authentication secret. Creation checks every candidate against live session state and retries collisions with a bounded budget; if a unique ID cannot be allocated, creation fails closed instead of replacing an existing live session.

After WebRTC negotiation, each DataChannel must complete mutual application-level key confirmation. The proof key is independently derived from the raw pairing secret using HKDF-SHA-256 with session-specific context, and HMAC proofs include both the session identifier and claimed peer role. Wrong-secret, wrong-session, wrong-role, malformed, or timed-out confirmation fails closed before the DataChannel is handed to the transfer engine.

A future human-typed short code must **not** be treated as an encryption secret. Short codes have insufficient entropy and are vulnerable to online guessing. The approved policy is that a typed code may identify a rendezvous only; authentication must use a PAKE or an equivalent high-entropy authenticated key-confirmation design, with strict expiration plus source/session attempt limits. Bridge does not currently expose a typed-code flow and must not add one by simply shortening the existing session ID or verifier.

## Transfer protection

Bridge derives a 256-bit AES-GCM key from the pairing secret using HKDF-SHA-256 with session-specific context. Each transfer uses its own random nonce material and authenticates chunk context including the transfer identifier and chunk index. AES-GCM authentication failures abort the receive sink and cancel the transfer.

Whole-payload SHA-256 verification is performed before a transfer is reported complete. Receive-side chunk ordering is enforced. Resume begins from the receiver's last verified chunk boundary rather than trusting sender progress state.

WebRTC DataChannels are configured ordered and reliable. Bridge therefore does not implement a second packet retransmission protocol; application resume only handles interruption/reconnection boundaries.

Memory-backed payload classes have explicit protocol ceilings before receive state is created: text and clipboard payloads are limited to 1 MiB and link payloads to 16 KiB. File offers are not subject to those text-like limits because Bridge supports streaming them to disk. The browser-memory receive sink separately enforces a 256 MiB hard ceiling, and the UI does not expose its memory receive action above that limit; supported browsers can instead stream files directly to a user-approved File System Access sink. These limits reduce accidental or malicious endpoint memory exhaustion after an authenticated peer is connected without preventing large streamed file transfers.

## Main threats and mitigations

| Threat | Current mitigation | Remaining work |
| --- | --- | --- |
| Passive network interception | WebRTC DTLS + application AES-GCM | Keep dependencies/browser minimums current |
| Signaling service reads transfer content | Payload bytes never sent through signaling; application encryption | Production deployment review |
| Signaling substitution/MITM | Raw secret withheld from signaling; session/role-bound HMAC key confirmation before channel activation | Keep adversarial browser coverage current |
| Pairing-link theft | 256-bit random fragment secret; short session TTL | Improve UI warning/copy hygiene |
| Signaling-admission verifier theft | Raw secret is not exposed; WSS protects verifier in transit | Enforce HTTPS/WSS at production edge |
| Rendezvous ID collision | Creation retries candidates already present in live session state and fails closed after a bounded retry budget | Keep allocator coverage and ID-space assumptions under review |
| Online guessing of QR secret | High entropy plus create/join/message throttles and strict ID parsing | Shared/edge limiter for multi-replica production |
| Future short-code guessing | Typed code not exposed; policy requires PAKE/equivalent authentication and strict limits | Implement only after protocol design review |
| Ciphertext corruption/tampering | AES-GCM authentication + SHA-256 completion verification | Keep adversarial browser coverage current |
| Chunk reordering | Receiver enforces expected chunk index | Keep adversarial browser coverage current |
| Lost connection | ICE restart + replacement DataChannel + verified-boundary resume + re-confirmation | Real adapter/network-path release verification |
| Malicious peer sends huge payload | Incoming approval; 1 MiB text/clipboard and 16 KiB link protocol ceilings; 256 MiB memory-sink ceiling; direct-to-disk streaming for supported file receives | Keep limits reviewed against browser behavior and product requirements |
| TURN operator inspects content | DTLS + application encryption | Production TURN hardening/runbook execution |
| IP/network metadata exposure | Direct/relayed route is surfaced and user-facing relay-only transport fails closed without usable TURN | Production TURN operator/privacy review |
| XSS/client compromise | Minimal dependency surface; no raw received text injected as HTML; reviewed CSP/security-header baseline | Narrow production `connect-src` to the selected signaling origin and keep dependency review current |
| Denial of service | Session TTL/cleanup, bounded reconnect, max WebSocket payload, per-connection/source rate limits, session/connection caps, unattached-socket deadline, bounded operator configuration, and bounded memory-backed payload classes | Trusted-edge/shared rate limiting for multi-replica production |

## Privacy mode

Bridge exposes relay-only privacy mode through `iceTransportPolicy: "relay"`. When enabled, Bridge explains the tradeoff accurately: relay-only can reduce direct peer IP exposure to the other endpoint, but it routes traffic through TURN, may be slower, costs relay bandwidth, and does not provide anonymity from the TURN operator or Bridge infrastructure. Missing usable TURN configuration fails closed instead of silently downgrading to direct connectivity.

## Release blockers

Before a production security claim is made, Bridge still needs the environment-dependent release boundary to be completed:

1. configure the exact production frontend/signaling origins, require HTTPS/WSS, and narrow CSP `connect-src` to the selected signaling origin;
2. provision the production TURN service and execute the documented credential/rotation/operator policy without committing secrets;
3. configure trusted-edge or shared signaling limits if production uses multiple signaling replicas;
4. complete the dependency-backed repository validation plus final manual accessibility/native-browser review;
5. execute the production smoke test against the deployed frontend, signaling, and TURN infrastructure.
