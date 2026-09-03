import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkflowConcurrency } from "./verify-workflow-concurrency.mjs";

const expected = /^bridge-ci-\$\{\{ github\.ref \}\}$/;

function workflow(concurrency) {
  return `name: Bridge CI\non:\n  workflow_dispatch:\n${concurrency}\npermissions:\n  contents: read\njobs:\n  validate:\n    runs-on: ubuntu-24.04\n`;
}

test("accepts reviewed concurrency block", () => {
  assert.deepEqual(
    validateWorkflowConcurrency(
      workflow("concurrency:\n  group: bridge-ci-${{ github.ref }}\n  cancel-in-progress: true"),
      expected,
    ),
    [],
  );
});

test("rejects missing concurrency", () => {
  assert.match(validateWorkflowConcurrency(workflow(""), expected)[0], /top-level concurrency/);
});

test("rejects mutable or shared concurrency group", () => {
  const errors = validateWorkflowConcurrency(
    workflow("concurrency:\n  group: bridge-ci\n  cancel-in-progress: true"),
    expected,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /reviewed value/);
});

test("rejects cancel-in-progress false", () => {
  const errors = validateWorkflowConcurrency(
    workflow("concurrency:\n  group: bridge-ci-${{ github.ref }}\n  cancel-in-progress: false"),
    expected,
  );
  assert.deepEqual(errors, ["concurrency cancel-in-progress must be true"]);
});

test("rejects duplicate top-level concurrency blocks", () => {
  const content = workflow(
    "concurrency:\n  group: bridge-ci-${{ github.ref }}\n  cancel-in-progress: true\n\nconcurrency:\n  group: bridge-ci-${{ github.ref }}\n  cancel-in-progress: true",
  );
  assert.deepEqual(validateWorkflowConcurrency(content, expected), ["workflow must define top-level concurrency exactly once"]);
});
