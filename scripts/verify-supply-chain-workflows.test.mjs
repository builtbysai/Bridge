import assert from "node:assert/strict";
import test from "node:test";

import {
  extractWorkflowActionReferences,
  findNpmCiWithoutIgnoreScripts,
  findNpxWithoutNoInstall,
  isImmutableGitHubActionReference,
} from "./verify-supply-chain-workflows.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("extractWorkflowActionReferences finds normal step and job-level uses syntax", () => {
  const workflow = `
steps:
  - uses: actions/checkout@${SHA} # pinned checkout
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

test("immutable action policy accepts only GitHub action references pinned to full SHAs", () => {
  assert.equal(isImmutableGitHubActionReference(`actions/checkout@${SHA}`), true);
  assert.equal(isImmutableGitHubActionReference(`owner/action/path@${SHA.toUpperCase()}`), true);

  assert.equal(isImmutableGitHubActionReference("actions/checkout@v6"), false);
  assert.equal(isImmutableGitHubActionReference("actions/checkout@main"), false);
  assert.equal(isImmutableGitHubActionReference("actions/checkout"), false);
  assert.equal(isImmutableGitHubActionReference(`./local-action@${SHA}`), false);
  assert.equal(isImmutableGitHubActionReference(`docker://alpine@${SHA}`), false);
});

test("realistic workflow step syntax cannot bypass mutable-reference rejection", () => {
  const workflow = `
steps:
  - uses: actions/checkout@v6
  - name: Setup
    uses: actions/setup-node@${SHA}
`;

  const references = extractWorkflowActionReferences(workflow);
  assert.deepEqual(references, ["actions/checkout@v6", `actions/setup-node@${SHA}`]);
  assert.equal(references.every(isImmutableGitHubActionReference), false);
});

test("npm ci policy finds every install that can execute lifecycle scripts", () => {
  const workflow = `
steps:
  - run: npm ci --ignore-scripts --no-audit --no-fund
  - run: npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  - run: npm ci --no-audit --no-fund
  - run: npm ci --omit=dev --no-audit --no-fund
`;

  assert.deepEqual(findNpmCiWithoutIgnoreScripts(workflow), [
    "- run: npm ci --no-audit --no-fund",
    "- run: npm ci --omit=dev --no-audit --no-fund",
  ]);
});

test("npm ci policy accepts ignore-scripts regardless of option position", () => {
  const workflow = `
run: npm ci --ignore-scripts --no-fund
run: npm ci --no-fund --ignore-scripts
run: npm ci --omit=dev --ignore-scripts --no-audit
`;

  assert.deepEqual(findNpmCiWithoutIgnoreScripts(workflow), []);
});

test("npx policy rejects commands that can download missing executables", () => {
  const workflow = `
steps:
  - run: npx playwright install chromium
  - run: npx --yes some-tool check
  - run: npx --no-install playwright install chromium
`;

  assert.deepEqual(findNpxWithoutNoInstall(workflow), [
    "- run: npx playwright install chromium",
    "- run: npx --yes some-tool check",
  ]);
});

test("npx policy accepts no-install regardless of option position", () => {
  const workflow = `
run: npx --no-install playwright install chromium
run: npx playwright --no-install install chromium
`;

  assert.deepEqual(findNpxWithoutNoInstall(workflow), []);
});
