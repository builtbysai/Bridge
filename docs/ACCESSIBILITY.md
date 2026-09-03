# Bridge accessibility audit

This checklist tracks repository-side accessibility requirements before release. Automated checks supplement, but do not replace, assistive-technology and OS/browser walkthroughs.

## Implemented baseline

- Semantic buttons are used for transfer, request, approval, cancellation, copy, and queue actions.
- The file drop target is keyboard operable with Enter/Space and exposes `role="button"` plus `aria-disabled`.
- Incoming transfer/request regions use live-region semantics so new peer actions are announced.
- Browser network loss is announced through a polite atomic status region and immediately pauses primary send/request actions, drop activation, and incoming transfer/request decisions until the browser is online and the connected UI state is ready again. The pause guard observes the document subtree so controls inserted or re-enabled while a network pause is active are forced back to disabled instead of escaping the safety boundary.
- Transfer and queue progress use native `<progress>` elements with explicit reviewed track, fill, and boundary colors rather than browser defaults.
- Transfer progress exposes its visible transfer title as the programmatic label and its byte/speed text as the description; dynamically rendered queue progress bars receive file-specific accessible names so multiple progress indicators are distinguishable to assistive technology.
- Transfer progress feeds a visually hidden polite/atomic status region at coarse 25%, 50%, 75%, and 100% milestones so per-chunk updates do not flood assistive technology.
- Device naming uses an explicit label, bounded input, `aria-expanded` disclosure, visible focus treatment, focus restoration after save, and a polite status announcement.
- Text-like received content remains selectable and has an explicit Copy action.
- Direct/Relayed and other security/privacy states are communicated with text, not color alone.
- Buttons, text inputs, and the custom drop target receive an explicit 3px `:focus-visible` outline.
- `prefers-reduced-motion: reduce` suppresses nonessential CSS transition/animation timing.
- Forced-colors CSS maps focus outlines to system Highlight, keeps major cards/status surfaces visibly bordered with system colors, removes decorative status-dot glow, and gives progress bars explicit system-color boundaries.

## Automated checks

Run `npm run test:e2e` after installing Playwright's Chromium, Firefox, and WebKit browsers. The manual Bridge CI workflow installs all three engines with system dependencies after unit tests, typecheck, and build.

Chromium remains the full end-to-end engine because Bridge's authenticated two-peer, recovery instrumentation, native-dialog, file-chooser, forced-colors, deterministic layout-zoom, and local-TURN regressions depend on Chromium-specific test behavior. The Chromium suite includes:

- axe WCAG A/AA serious/critical gates on host, Receive Portal, authenticated connected peers, and a deterministic missing-session signaling failure;
- explicit axe `color-contrast` gates for static, connected, route-status, and failure-state text;
- keyboard focus-cycle checks that fail on hidden focus targets or missing indicators and require outline indicators to meet at least 3:1 non-text contrast against alpha-composited ancestor backgrounds;
- connected keyboard approval, active queue cancellation, receiver-initiated request fulfillment, declined-request recovery, and post-recovery primary-action checks;
- authenticated DataChannel interruption/recovery with a replacement confirmed channel and encrypted transfer after recovery;
- browser offline/online interruption coverage that requires a polite loss/restoration announcement, disables primary transfer/drop actions and pending incoming peer decisions while offline, proves transfer controls inserted during the pause are immediately disabled, and safely re-enables controls only after connectivity returns to an already connected peer state;
- native prompt cancellation/focus restoration and file-chooser selection/focus restoration;
- active progress fill/track and boundary/surrounding-surface contrast checks at the WCAG 2.2 3:1 non-text threshold;
- transfer-progress semantics that require the global progress indicator to reference its visible title/detail and require dynamically inserted queue progress indicators to expose file-specific accessible names;
- forced-colors/high-contrast rendering and focus checks;
- narrow-viewport overflow, deterministic 200% layout-zoom reflow, and reduced-motion checks;
- real two-peer encrypted text/file queue coverage and the disposable local-coturn relay-only path.

A dedicated browser-neutral smoke suite now runs in Chromium, Firefox, and WebKit. At a 320px viewport it verifies the host shell and Receive Portal have no serious/critical axe findings, remain keyboard reachable with a rendered focus indicator, and avoid page-level horizontal overflow. It also exercises the real missing-session failure state in each engine, requiring the connection problem to be visible, send actions to stay disabled, the drop target to remain `aria-disabled`, the page to avoid overflow, and the failed state to pass the serious/critical axe gate. This converts baseline non-Chromium rendering, focus, and failure-state behavior from manual-only coverage into a repeatable repository-side regression gate.

Unit coverage separately verifies transfer-progress announcement throttling, reset behavior for repeated labels, and milestone jumps.

## Release checks still required

- [ ] Keyboard-only walkthrough of host, guest, Receive Portal, request, approval, transfer queue, cancellation, and error recovery flows. Static host/portal reachability and missing-session failure behavior now run in Chromium, Firefox, and WebKit; connected approval/cancellation/request/recovery, browser offline/online interruption behavior (including pending and dynamically inserted incoming peer decisions), and Chromium native-dialog/file-picker paths are automated. A human walkthrough remains required for OS-native picker/dialog details, picker cancellation behavior not exposed by Playwright, real adapter/network-path failures beyond browser offline emulation, and OS-specific focus handling.
- [ ] Screen-reader walkthrough in at least one Chromium + NVDA/JAWS-class combination and Safari + VoiceOver where available. Confirm that the global transfer progress is announced with its transfer name/details and that queue progress bars are distinguishable by file name without relying on visual position.
- [ ] Verify visible focus treatment for every interactive control, including dynamically inserted queue and device-name controls. Static focus is cross-browser smoke-tested; connected/dynamic focus has Chromium coverage; native/OS-specific states still require human review.
- [ ] Verify 200% native browser zoom without clipped controls or horizontal scrolling. Automated 320px overflow checks now run across Chromium, Firefox, and WebKit, and Chromium also has a deterministic 200% layout-zoom regression proxy.
- [ ] Verify contrast for normal text, muted text, focus indicators, progress UI, and Direct/Relayed badges against WCAG 2.2 AA targets. Automated Chromium gates cover static/connected/failure text, route badges, focus outlines, progress rendering, forced-colors behavior, and the browser-offline interruption message. Manual review remains for native browser/OS rendering and real adapter/network-path failure states.
- [x] Verify motion/animation behavior under `prefers-reduced-motion`; Playwright emulates reduced motion and asserts transition timing is suppressed.
- [x] Add milestone-based transfer progress announcements that are useful without being excessively chatty; Bridge announces only 25/50/75/100% through a polite live region, with unit coverage for throttling/reset behavior.
- [x] Add automated axe/Playwright accessibility checks; automated scans supplement rather than replace manual assistive-technology checks.

The human review must be captured in `docs/ACCESSIBILITY_REVIEW_RECORD.md`; automated results alone must not change that record to complete. `npm run verify:accessibility-record` checks that the record remains structurally valid while it is pending. After a reviewer fills the real environments/evidence, checks every required walkthrough, and records a passing result, `npm run verify:accessibility-complete` provides a strict release check that rejects pending status, unchecked walkthroughs, or placeholder metadata.

## Naming/privacy boundary

Device names are local UI preferences in the current release. Bridge does not send them through signaling or the transfer protocol, avoiding a new stable identifier at the rendezvous service. If peer-visible names are added later, they should travel only after the authenticated encrypted channel is established, should remain optional, and should not be persisted remotely by Bridge infrastructure.
