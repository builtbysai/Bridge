import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractWorkflowActionReferences,
  isImmutableGitHubActionReference,
} from "./release-preflight.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("release preflight sees normal step and reusable-workflow action references", () => {
  const workflow = `
steps:
  - uses: actions/checkout@${SHA} # checkout
  - name: Upload
    uses: actions/upload-artifact@${SHA}
reusable:
  uses: owner/reusable/.github/workflows/test.yml@${SHA}
`;

  assert.deepEqual(extractWorkflowActionReferences(workflow), [
    `actions/checkout@${SHA}`,
    `actions/upload-artifact@${SHA}`,
    `owner/reusable/.github/workflows/test.yml@${SHA}`,
  ]);
});

test("release preflight immutable action policy rejects mutable and local references", () => {
  assert.equal(isImmutableGitHubActionReference(`actions/checkout@${SHA}`), true);
  assert.equal(isImmutableGitHubActionReference(`owner/action/path@${SHA.toUpperCase()}`), true);
  assert.equal(isImmutableGitHubActionReference("actions/checkout@v6"), false);
  assert.equal(isImmutableGitHubActionReference("actions/checkout@main"), false);
  assert.equal(isImmutableGitHubActionReference("actions/checkout"), false);
  assert.equal(isImmutableGitHubActionReference(`./local-action@${SHA}`), false);
  assert.equal(isImmutableGitHubActionReference(`docker://alpine@${SHA}`), false);
});

test("normal list-item syntax cannot hide a mutable action from release preflight", () => {
  const workflow = `
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@${SHA}
`;

  const references = extractWorkflowActionReferences(workflow);
  assert.deepEqual(references, ["actions/checkout@v6", `actions/setup-node@${SHA}`]);
  assert.equal(references.every(isImmutableGitHubActionReference), false);
});

test("release preflight delegates lockfile transition policy to the reviewed mode verifier", () => {
  const source = readFileSync(fileURLToPath(new URL("./release-preflight.mjs", import.meta.url)), "utf8");

  assert.match(
    source,
    /import \{ classifyLockfileMode, verifyWorkflowForLockfileMode \} from "\.\/verify-lockfile-mode\.mjs";/,
  );
  assert.match(source, /verifyWorkflowForLockfileMode\(workflow, content, lockfileMode\)/);
  assert.doesNotMatch(source, /must generate registry-backed lockfiles until reviewed lockfiles are committed/);
  assert.doesNotMatch(source, /content\.includes\("npm run lockfiles:generate"\) \|\|/);
});
