# Frontend signaling URL policy

Bridge treats the frontend signaling endpoint as release configuration, not as a production default.

- Local HTTP development may omit `VITE_SIGNALING_URL`; Bridge then uses `ws://<page-host>:8787/signal`.
- An HTTPS deployment must set `VITE_SIGNALING_URL` explicitly. Missing configuration fails closed instead of guessing a production endpoint.
- HTTPS pages require a `wss:` signaling URL.
- The configured URL must be absolute, must target the exact `/signal` path, and must not contain URL credentials, query parameters, or fragments. Pairing secrets and operator credentials therefore cannot be smuggled into the signaling URL.

A normal production value looks like:

```text
VITE_SIGNALING_URL=wss://signal.example.com/signal
```

This value is browser-visible configuration. It is not a place for TURN credentials, bearer tokens, hosting tokens, or other secrets.

At release time, keep this value aligned with both the signaling service's `SIGNAL_ALLOWED_ORIGINS` setting and the frontend CSP `connect-src` policy documented in `SECURITY_HEADERS.md` and `DEPLOYMENT.md`.
