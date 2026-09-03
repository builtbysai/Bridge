import assert from "node:assert/strict";
import test from "node:test";

import { extractWorkflowJobs, validateWorkflowJobTimeouts } from "./verify-workflow-job-timeouts.mjs";

test("extractWorkflowJobs finds every explicit jobs entry", () => {
  const workflow = `
name: Example
jobs:
  first:
    runs-on: ubuntu-latest
    timeout-minutes: 10
  second:
    runs-on: ubuntu-latest
    timeout-minutes: 20
permissions:
  contents: read
`;

  assert.deepEqual(extractWorkflowJobs(workflow).map((job) => job.name), ["first", "second"]);
});

test("timeout policy requires one bounded timeout on every job", () => {
  const valid = `
jobs:
  first:
    runs-on: ubuntu-latest
    timeout-minutes: 1
  second:
    timeout-minutes: 60
    runs-on: ubuntu-latest
`;
  assert.deepEqual(validateWorkflowJobTimeouts(valid), []);

  const missing = `
jobs:
  first:
    timeout-minutes: 10
  second:
    runs-on: ubuntu-latest
`;
  assert.deepEqual(validateWorkflowJobTimeouts(missing), ["job second must define timeout-minutes"]);
});

test("timeout policy rejects duplicate and out-of-range values", () => {
  const workflow = `
jobs:
  zero:
    timeout-minutes: 0
  too_large:
    timeout-minutes: 61
  duplicate:
    timeout-minutes: 10
    timeout-minutes: 20
`;

  assert.deepEqual(validateWorkflowJobTimeouts(workflow), [
    "job zero timeout-minutes must be between 1 and 60, found 0",
    "job too_large timeout-minutes must be between 1 and 60, found 61",
    "job duplicate must define timeout-minutes exactly once",
  ]);
});

test("timeout policy fails closed when no explicit jobs exist", () => {
  assert.deepEqual(validateWorkflowJobTimeouts("name: no jobs\n"), ["workflow must define at least one explicit job"]);
});
