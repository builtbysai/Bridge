import assert from "node:assert/strict";
import test from "node:test";
import { verifyAccessibilityReviewRecord } from "./verify-accessibility-review-record.mjs";

const pending = `# Bridge manual accessibility review record

Review status: **PENDING**

## Review metadata

- Reviewer: PENDING
- Review date: PENDING
- Primary OS/browser: PENDING
- Assistive technology: PENDING
- Secondary OS/browser: PENDING

## Required walkthroughs

- [ ] [A11Y-01] Keyboard-only host flow
- [ ] [A11Y-02] Keyboard-only guest flow
- [ ] [A11Y-03] Screen-reader flow
- [ ] [A11Y-04] Native 200% zoom
- [ ] [A11Y-05] Native dialog focus return
- [ ] [A11Y-06] Real network interruption
- [ ] [A11Y-07] Native rendering review
- [ ] [A11Y-08] Safari and VoiceOver

## Findings

- Result: PENDING
`;

const complete = `# Bridge manual accessibility review record

Review status: **COMPLETE**

## Review metadata

- Reviewer: Release reviewer
- Review date: 2026-09-01
- Primary OS/browser: Windows 11 / Chromium 140
- Assistive technology: NVDA 2026.2
- Secondary OS/browser: macOS 15 / Safari 19

## Required walkthroughs

- [x] [A11Y-01] Keyboard-only host flow
- [x] [A11Y-02] Keyboard-only guest flow
- [x] [A11Y-03] Screen-reader flow
- [x] [A11Y-04] Native 200% zoom
- [x] [A11Y-05] Native dialog focus return
- [x] [A11Y-06] Real network interruption
- [x] [A11Y-07] Native rendering review
- [x] [A11Y-08] Safari and VoiceOver

## Findings

- Result: PASS
- Blocking findings: None
- Follow-up issues/links: None
- Notes: Reviewed on native systems
`;

test("pending record is structurally valid without claiming completion", () => {
  assert.equal(verifyAccessibilityReviewRecord(pending), "PENDING");
});

test("require-complete rejects a pending review", () => {
  assert.throws(() => verifyAccessibilityReviewRecord(pending, { requireComplete: true }), /still pending/);
});

test("complete record passes when required evidence is filled", () => {
  assert.equal(verifyAccessibilityReviewRecord(complete, { requireComplete: true }), "COMPLETE");
});

test("complete record rejects unchecked walkthroughs", () => {
  assert.throws(
    () => verifyAccessibilityReviewRecord(complete.replace("- [x] [A11Y-03] Screen-reader flow", "- [ ] [A11Y-03] Screen-reader flow"), { requireComplete: true }),
    /unchecked required walkthrough.*A11Y-03/,
  );
});

test("record rejects deletion of a required walkthrough", () => {
  assert.throws(
    () => verifyAccessibilityReviewRecord(complete.replace("- [x] [A11Y-06] Real network interruption\n", ""), { requireComplete: true }),
    /missing required walkthrough: A11Y-06/,
  );
});

test("record rejects duplicate required walkthrough ids", () => {
  assert.throws(
    () => verifyAccessibilityReviewRecord(complete.replace("- [x] [A11Y-02] Keyboard-only guest flow", "- [x] [A11Y-01] Keyboard-only guest flow"), { requireComplete: true }),
    /duplicate required walkthrough id: A11Y-01/,
  );
});

test("complete record rejects placeholder metadata", () => {
  assert.throws(
    () => verifyAccessibilityReviewRecord(complete.replace("- Reviewer: Release reviewer", "- Reviewer: TBD"), { requireComplete: true }),
    /placeholder metadata/,
  );
});
