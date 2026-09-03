import assert from "node:assert/strict";
import test from "node:test";

import {
  findCheckoutStepsWithoutCredentialIsolation,
  validateCheckoutCredentialIsolation,
} from "./verify-checkout-credentials.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("accepts checkout only when persist-credentials false is inside its with block", () => {
  const workflow = `
jobs:
  validate:
    steps:
      - uses: actions/checkout@${SHA}
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@${SHA}
`;

  assert.deepEqual(findCheckoutStepsWithoutCredentialIsolation(workflow), []);
  assert.doesNotThrow(() => validateCheckoutCredentialIsolation(workflow, "safe.yml"));
});

test("rejects a checkout without persist-credentials false", () => {
  const workflow = `
steps:
  - uses: actions/checkout@${SHA}
    with:
      fetch-depth: 0
`;

  assert.deepEqual(findCheckoutStepsWithoutCredentialIsolation(workflow), [`actions/checkout@${SHA}`]);
  assert.throws(() => validateCheckoutCredentialIsolation(workflow, "missing.yml"), /persist-credentials: false/);
});

test("rejects a checkout when an unrelated later step contains persist-credentials false", () => {
  const workflow = `
steps:
  - uses: actions/checkout@${SHA}
    with:
      fetch-depth: 0
  - name: Unrelated
    env:
      persist-credentials: false
    run: echo safe-looking
`;

  assert.deepEqual(findCheckoutStepsWithoutCredentialIsolation(workflow), [`actions/checkout@${SHA}`]);
});

test("rejects mixed checkout safety even when global counts match", () => {
  const workflow = `
steps:
  - uses: actions/checkout@${SHA}
    with:
      fetch-depth: 0
  - uses: actions/checkout@${SHA}
    with:
      persist-credentials: false
      another-setting: value
      # A second unrelated occurrence made the old count-based check pass.
      note: persist-credentials: false
`;

  assert.deepEqual(findCheckoutStepsWithoutCredentialIsolation(workflow), [`actions/checkout@${SHA}`]);
  assert.throws(() => validateCheckoutCredentialIsolation(workflow, "mixed.yml"), /unsafe/);
});

test("fails closed when a workflow has no checkout step", () => {
  assert.throws(
    () => validateCheckoutCredentialIsolation("steps:\n  - run: echo hello\n", "empty.yml"),
    /at least one actions\/checkout step/,
  );
});
