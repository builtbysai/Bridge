import assert from "node:assert/strict";
import test from "node:test";

import {
  extractUploadArtifactRetentions,
  findArtifactRetentionViolations,
} from "./verify-artifact-retention.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("extracts retention from named and direct upload-artifact steps", () => {
  const workflow = `
steps:
  - name: Upload review artifact
    uses: actions/upload-artifact@${SHA}
    with:
      name: review
      path: artifact.json
      retention-days: 7
  - uses: actions/upload-artifact@${SHA}
    with:
      name: release
      path: dist
      retention-days: 14
`;

  assert.deepEqual(extractUploadArtifactRetentions(workflow), [7, 14]);
});

test("rejects missing, invalid, zero, and excessive retention", () => {
  const workflow = `
steps:
  - uses: actions/upload-artifact@${SHA}
    with:
      name: missing
      path: missing.json
  - uses: actions/upload-artifact@${SHA}
    with:
      retention-days: seven
  - uses: actions/upload-artifact@${SHA}
    with:
      retention-days: 0
  - uses: actions/upload-artifact@${SHA}
    with:
      retention-days: 8
`;

  assert.equal(findArtifactRetentionViolations(workflow, 7).length, 4);
});

test("accepts every upload only when retention stays inside the reviewed bound", () => {
  const workflow = `
steps:
  - name: Upload SBOM
    uses: actions/upload-artifact@${SHA}
    with:
      retention-days: 7
  - name: Upload lockfiles
    uses: actions/upload-artifact@${SHA}
    with:
      retention-days: 3
`;

  assert.deepEqual(findArtifactRetentionViolations(workflow, 7), []);
});

test("fails closed when a reviewed workflow has no upload-artifact step", () => {
  assert.deepEqual(findArtifactRetentionViolations("steps:\n  - run: npm test\n", 7), [
    "no upload-artifact steps found",
  ]);
});
