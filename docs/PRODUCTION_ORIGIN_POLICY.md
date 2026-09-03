# Production signaling Origin policy

Bridge treats browser WebSocket Origin admission as a production security boundary.

When the signaling service runs with `NODE_ENV=production`, startup must fail unless `SIGNAL_ALLOWED_ORIGINS` contains at least one exact browser origin. Every configured production origin must use `https:` and must not resolve to a loopback-style browser origin (`localhost`, `*.localhost`, `127.0.0.0/8`, or IPv6 loopback). The runtime rejects missing or untrusted WebSocket `Origin` values before signaling admission.

Local development and repository integration tests may omit the allowlist or use localhost only because they are explicit non-production modes. Operators must not use that relaxed mode for an Internet-facing signaling service.

At the production release boundary:

1. Set `NODE_ENV=production` for the signaling runtime.
2. Set `SIGNAL_ALLOWED_ORIGINS` to the exact deployed frontend origin or comma-separated set of exact trusted frontend origins.
3. Use only non-loopback HTTPS frontend origins so an accidental localhost/loopback value cannot make a nominal production runtime accept only browsers running on the signaling host.
4. Narrow the frontend CSP `connect-src` from the repository's provider-neutral secure-WebSocket baseline to the selected production signaling origin.
5. Verify an allowed frontend can connect and an untrusted or missing Origin is rejected during the deployed smoke test.

`scripts/verify-production-origin-policy.mjs` is dependency-free and guards the repository-side invariant that production configuration requires a non-empty, HTTPS, non-loopback allowlist and that the operator contract remains documented. `scripts/verify-production-deployment-config.mjs` applies the same loopback-family definition to `BRIDGE_FRONTEND_ORIGIN`, `VITE_SIGNALING_URL`, and every `SIGNAL_ALLOWED_ORIGINS` entry, so artifact/deployment preflight cannot approve a configuration the production signaling runtime will reject. Focused dependency-free tests cover `*.localhost`, the full `127.0.0.0/8` family, and IPv6 loopback. These checks do not replace the deployed smoke test.
