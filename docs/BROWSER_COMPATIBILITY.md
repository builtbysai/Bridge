# Browser compatibility and progressive enhancement

Bridge's minimum product contract is: pair two modern browsers, establish a WebRTC DataChannel, and transfer encrypted payloads. Everything beyond that baseline is progressively enhanced.

## Capability matrix

| Capability | Requirement | Bridge behavior when unavailable |
| --- | --- | --- |
| WebRTC DataChannel | Required | Transfer cannot start; show a connection error. |
| Web Crypto (HKDF, AES-GCM, SHA-256) | Required | Secure transfer cannot start. |
| WebSocket | Required for normal online pairing | Offline/manual signaling is a future mode. |
| File System Access save picker | Optional | Receiver uses the browser-memory/download fallback. |
| Screen Wake Lock | Optional | Transfer continues, but the OS may dim/lock the screen; UI should advise keeping the page active for large transfers. |
| Service Worker / installable PWA | Optional | Bridge remains a normal HTTPS web app. |
| Clipboard API | Optional | Copy/paste UI falls back to explicit text selection/manual copy where needed. |

## Current support policy

Bridge targets current stable Chromium, Firefox, and Safari releases on desktop, plus current Chrome/Android and Safari/iOS. It does not promise identical native-integration features across engines.

The WebRTC DataChannel API is broadly established across current browsers. Bridge uses the default reliable/ordered DataChannel behavior and application-level chunk framing/backpressure on top of SCTP/DTLS.

The Screen Wake Lock API is a progressive enhancement and requires HTTPS. MDN marks it Baseline 2025 across current browser generations. Bridge requests it only while an active transfer is in progress, releases it afterward, and attempts reacquisition when a visible page resumes after the platform revokes the lock.

File System Access support varies more by browser and operation. Bridge therefore never makes direct-to-disk writing mandatory. When a save picker/writable stream is unavailable, the receiver offers its browser-download fallback instead.

## Production test matrix

Before release, smoke-test at least:

- Chrome desktop: direct file transfer, request flow, direct-to-disk save, PWA install.
- Firefox desktop: direct file transfer, request flow, fallback download path.
- Safari desktop: direct file transfer, request flow, fallback behavior.
- Chrome Android: QR join, send/receive, wake lock during a large transfer, installability.
- Safari iOS: QR join, foreground transfer, interruption/reconnect behavior, installed web-app mode where available.
- A restrictive network path that forces TURN relay.

## Known browser constraints

Mobile operating systems may throttle or suspend background tabs/web apps. Wake Lock reduces screen-lock interruptions but is not a guarantee that a browser process will remain active indefinitely. Bridge must retain reconnect/resume semantics as a separate resilience concern.

Direct peer-to-peer WebRTC can disclose peer network-address information. A future relay-only privacy mode will force TURN when users prefer address privacy over direct-path performance.

## References

- MDN — RTCDataChannel: https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
- MDN — Screen Wake Lock API: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- MDN — FileSystemFileHandle: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle
