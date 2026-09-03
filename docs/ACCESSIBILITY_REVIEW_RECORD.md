# Bridge manual accessibility review record

Review status: **PENDING**

This record is intentionally incomplete until a human performs the release accessibility walkthrough on real OS/browser/assistive-technology combinations. Do not mark it complete from automated test results alone.

## Review metadata

- Reviewer: PENDING
- Review date: PENDING
- Primary OS/browser: PENDING
- Assistive technology: PENDING
- Secondary OS/browser: PENDING

## Required walkthroughs

- [ ] [A11Y-01] Keyboard-only host flow: create session, pair, send, request, approve/decline, cancel, disconnect/recover.
- [ ] [A11Y-02] Keyboard-only guest and Receive Portal flow, including file selection, text/link/clipboard actions, and error states.
- [ ] [A11Y-03] Screen-reader walkthrough of host and Receive Portal, including pairing state, incoming requests, transfer progress milestones, queue item names, completion, cancellation, and errors.
- [ ] [A11Y-04] Native 200% browser zoom check with no clipped controls or page-level horizontal scrolling.
- [ ] [A11Y-05] Native file-picker and dialog focus-return behavior, including cancellation paths not fully exposed by Playwright.
- [ ] [A11Y-06] Real network-adapter/path interruption and restoration, confirming status announcements and safe action disabling/re-enabling.
- [ ] [A11Y-07] Native rendering review for focus indicators, text contrast, Direct/Relayed badges, progress UI, forced/high-contrast behavior where supported, and reduced-motion behavior.
- [ ] [A11Y-08] Safari + VoiceOver walkthrough where available, or document why the environment was unavailable and what substitute coverage was used.

## Findings

- Result: PENDING
- Blocking findings: PENDING
- Follow-up issues/links: PENDING
- Notes: PENDING

## Completion rule

Change `Review status` to `COMPLETE` only after every required walkthrough is checked and the Findings result is `PASS` or `PASS WITH FOLLOW-UP`. Replace all placeholder metadata with the actual review environment and evidence. The stable `A11Y-01` through `A11Y-08` identifiers are part of the release evidence contract: do not delete, duplicate, or renumber them to bypass an unfinished walkthrough. Then run:

```sh
npm run verify:accessibility-complete
```

That command validates the record structure and fails if the review is still pending, any required walkthrough is missing or unchecked, duplicate walkthrough identifiers are present, or placeholder metadata remains.
