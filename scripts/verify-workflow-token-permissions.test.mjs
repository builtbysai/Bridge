import test from "node:test";
import assert from "node:assert/strict";

import { validateWorkflowTokenPermissions } from "./verify-workflow-token-permissions.mjs";

const validWorkflow = `name: Bridge CI
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-24.04
    steps:
      - run: echo ok
`;

test("accepts exactly top-level contents: read", () => {
  assert.equal(validateWorkflowTokenPermissions(validWorkflow), null);
});

test("rejects job-level permission override even with safe top-level permissions", () => {
  const workflow = `${validWorkflow}\n  publish:\n    permissions:\n      contents: write\n    runs-on: ubuntu-24.04\n`;
  assert.match(validateWorkflowTokenPermissions(workflow), /exactly one permissions declaration/);
});

test("rejects additional top-level token scopes", () => {
  const workflow = validWorkflow.replace("  contents: read", "  contents: read\n  id-token: write");
  assert.match(validateWorkflowTokenPermissions(workflow), /exactly \"contents: read\"/);
});

test("rejects inline or shorthand permissions declarations", () => {
  assert.match(
    validateWorkflowTokenPermissions(validWorkflow.replace("permissions:\n  contents: read", "permissions: read-all")),
    /reviewed mapping form/,
  );
});

test("rejects missing permissions declaration", () => {
  assert.match(
    validateWorkflowTokenPermissions(validWorkflow.replace("permissions:\n  contents: read\n", "")),
    /exactly one permissions declaration/,
  );
});
