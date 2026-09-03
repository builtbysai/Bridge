# Bridge privacy model

Bridge is a temporary browser-to-browser transfer tool. This document describes the intended data flows for the current repository implementation; it is not a substitute for the final legal privacy policy of whichever production service operates Bridge.

## Transfer content

Bridge does not intentionally upload file, text, link, or clipboard payloads to the signaling service. Payloads travel over a WebRTC DataChannel and are protected by WebRTC transport encryption plus Bridge's application-layer AES-GCM encryption derived from the pairing secret.

If WebRTC uses TURN, encrypted traffic passes through the configured TURN relay. The TURN operator can observe network metadata, timing, and encrypted traffic volume, but should not receive plaintext transfer payloads.

## Signaling data

The signaling service processes short-lived technical state needed to pair two peers and forward WebRTC negotiation messages. This includes a temporary session identifier, a 32-byte SHA-256 rendezvous verifier derived in the browser from the pairing secret, connection timing, and WebRTC signaling messages such as SDP descriptions and ICE candidates. The raw 256-bit QR pairing secret is not sent to the signaling service. The current service keeps session state in memory and expires it after the configured TTL.

The rendezvous verifier is still a temporary admission credential for the signaling session, so production signaling must use HTTPS/WSS and should avoid logging it. Possession of the verifier alone is not sufficient to derive Bridge's transfer encryption key or complete the DataChannel HMAC key-confirmation handshake, both of which require the raw pairing secret retained by the paired browsers.

Normal server/network logs may still contain IP addresses, request timestamps, user-agent information, errors, or other operational metadata depending on the production hosting configuration. Production deployment must document log retention and avoid logging pairing secrets, rendezvous verifiers, or URL fragments.

## Pairing links

QR/link sessions contain a high-entropy secret in the URL fragment (`#...`). Browser fragments are not normally sent to the web server as part of the HTTP request, but they remain visible to the browser and can be exposed through screenshots, copied URLs, clipboard history, extensions, screen sharing, or a person forwarding the link. Treat a full pairing link like a temporary credential.

After WebRTC negotiation, the paired browsers mutually prove possession of that raw secret with a session- and role-bound HMAC before Bridge exposes the DataChannel to transfer code. A signaling service can deny or disrupt a session, but signaling state alone should not be enough to impersonate a paired endpoint at the application layer.

## Local browser storage

The PWA service worker may cache static application assets and the navigation shell so Bridge can start reliably when installed. Transfer payloads are not intentionally written into application caches or IndexedDB by the current transfer implementation.

Bridge stores the user's relay-only privacy preference in `localStorage`. This preference contains no transfer content or pairing credential and only records whether future peer connections should require TURN relay routing.

A received file may be written to a user-selected destination through the File System Access API where supported. On fallback browsers, the current memory receive sink may temporarily hold received bytes in browser memory until download completion.

Clipboard actions use browser clipboard APIs only when the user invokes the relevant feature and the browser grants access. Clipboard contents should not be read continuously in the background.

## Metadata visible to the paired peer

A paired peer can necessarily learn transfer metadata such as filename, MIME type, byte size, transfer timing, and the contents deliberately sent. WebRTC connectivity can also expose network information needed for peer-to-peer routing. Direct connections may expose an IP address or network candidate to the other peer/browser implementation.

Bridge exposes a relay-only privacy control. When enabled, Bridge constructs the peer connection with `iceTransportPolicy: "relay"`, so a connection can only succeed through a configured TURN relay. Bridge does not silently fall back to direct ICE candidates in this mode. If no usable TURN service is configured, relay-only sessions fail to connect. Changing the preference reloads the page because ICE transport policy is selected when the peer connection is created.

Relay-only mode can reduce direct peer IP exposure, but it does not create anonymity. It shifts network metadata visibility to the TURN operator and still exposes normal transfer metadata to the paired endpoint. Production UI and documentation must not describe this mode as anonymous browsing or guaranteed identity protection.

## Retention and deletion claims

Bridge sessions are temporary, but the project must not claim guaranteed deletion or secure destruction. A recipient can save, copy, screenshot, log, or otherwise retain anything they receive. Browsers, operating systems, network infrastructure, and hosting providers may also retain operational data outside Bridge's direct control.

The signaling service should use short TTLs and avoid durable session persistence unless there is a clearly documented operational need. Production logs should have explicit retention periods.

## Accounts and identity

The current design does not require a user account. That does not make usage anonymous: hosting, signaling, STUN/TURN, network providers, and the paired peer can observe various identifiers or metadata.

## Production checklist

Before public deployment, the operator should publish concrete values for:

- signaling/session TTL;
- infrastructure providers and regions;
- operational log fields and retention periods;
- TURN provider and retention policy;
- abuse/rate-limit logging;
- support/security contact;
- cookie/analytics policy, if any analytics are later introduced;
- data deletion/contact process for operational logs where applicable.

Bridge should default to collecting no product analytics unless a production operator deliberately adds them and updates this document and the user-facing privacy notice accordingly.
