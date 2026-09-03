import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_GUARD_COMMANDS,
  findMissingWorkflowGuards,
  hasExactRunCommand,
  verifyWorkflowGuardCoverage,
} from "./verify-workflow-guard-coverage.mjs";

function workflowWith(commands = REQUIRED_GUARD_COMMANDS) {
  return commands.map((command) => `      - name: Guard\n        run: ${command}`).join("\n");
}

test("accepts a workflow that retains every reviewed guard command", () => {
  const content = workflowWith();
  assert.deepEqual(findMissingWorkflowGuards(content), []);
  assert.doesNotThrow(() => verifyWorkflowGuardCoverage("bridge.yml", content));
});

test("reports an omitted guard", () => {
  const omitted = "npm run verify:workflow-permissions";
  const content = workflowWith(REQUIRED_GUARD_COMMANDS.filter((command) => command !== omitted));
  assert.deepEqual(findMissingWorkflowGuards(content), [omitted]);
  assert.throws(() => verifyWorkflowGuardCoverage("bridge.yml", content), /verify:workflow-permissions/);
});

test("requires the exact toolchain policy guard", () => {
  const omitted = "npm run verify:toolchain";
  const content = workflowWith(REQUIRED_GUARD_COMMANDS.filter((command) => command !== omitted));
  assert.deepEqual(findMissingWorkflowGuards(content), [omitted]);
  assert.throws(() => verifyWorkflowGuardCoverage("bridge-deploy.yml", content), /verify:toolchain/);
});

test("comments and longer shell commands cannot impersonate an exact guard step", () => {
  assert.equal(hasExactRunCommand("# run: npm run verify:runner-image", "npm run verify:runner-image"), false);
  assert.equal(hasExactRunCommand("run: npm run verify:runner-image || true", "npm run verify:runner-image"), false);
  assert.equal(hasExactRunCommand("run: npm run verify:runner-image", "npm run verify:runner-image"), true);
});

test("reports every missing guard rather than stopping at the first", () => {
  const missing = REQUIRED_GUARD_COMMANDS.slice(0, 3);
  const content = workflowWith(REQUIRED_GUARD_COMMANDS.slice(3));
  assert.deepEqual(findMissingWorkflowGuards(content), missing);
});
