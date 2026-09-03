# Pairing secret browser lifecycle

Bridge uses a random 256-bit pairing secret as the high-entropy application authentication input. The secret is transported in the pairing URL fragment (`#key=...`) so it is not sent in the HTTP request to the static frontend or signaling service.

## Browser handling boundary

A guest page reads the fragment synchronously during application bootstrap. After `main.ts` has consumed the fragment into in-memory session state, `app-entry.js` calls `scrubConsumedPairingSecret()` and replaces the current browser history entry with the same URL minus the `key` fragment parameter.

The cleanup deliberately uses `history.replaceState()` rather than navigation. This means:

- the page does not reload;
- the session/query route remains intact;
- unrelated fragment parameters are preserved;
- the secret is removed from the visible address bar and the current Bridge history entry;
- the secret is not copied into `localStorage`, `sessionStorage`, cookies, IndexedDB, or another persistence mechanism.

The raw secret remains only in the JavaScript values already required for the active pairing/session. This cleanup reduces accidental disclosure through shoulder-surfing, copied address-bar URLs, screenshots, and later inspection of the current browser-history entry. It does not make a pairing URL safe to publish before it is opened, and it cannot revoke a secret that was copied or captured before Bridge consumed it.

## Failure behavior

If no `key` parameter exists, cleanup is a no-op. If a malformed pairing URL contains a `key` fragment, the application still handles the pairing attempt as invalid, while the post-bootstrap cleanup removes the fragment from the current history entry.

## Verification

Dependency-free coverage in `scripts/pairing-url-scrub.test.mjs` verifies query preservation, unrelated-fragment preservation, no-op behavior, current-entry replacement, and that the secret is absent from the replacement URL. Browser coverage in `e2e/pairing-url-privacy.spec.ts` verifies the fragment disappears after bootstrap and remains absent after reload without adding a new Bridge history entry.

The focused dependency-free test can run without registry dependencies as part of `npm run test:lockfile-policy`. The Playwright case remains part of the full dependency-backed release-validation gate.
