import assert from "node:assert/strict";
import test from "node:test";
import { runCommandWithRetries } from "./command-retry.mjs";

test("returns immediately on success", () => {
  let attempts = 0;
  const result = runCommandWithRetries({
    label: "test",
    run: () => {
      attempts += 1;
      return { status: 0 };
    },
    sleep: () => assert.fail("sleep should not run"),
  });
  assert.equal(result.status, 0);
  assert.equal(attempts, 1);
});

test("retries nonzero exits with bounded delays and then succeeds", () => {
  let attempts = 0;
  const sleeps = [];
  const retries = [];
  const result = runCommandWithRetries({
    label: "npm",
    run: () => {
      attempts += 1;
      return { status: attempts < 3 ? 1 : 0 };
    },
    delaysMs: [25, 75],
    sleep: value => sleeps.push(value),
    onRetry: info => retries.push(info),
  });
  assert.equal(result.status, 0);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [25, 75]);
  assert.deepEqual(retries.map(item => [item.attempt, item.nextAttempt, item.maxAttempts]), [[1, 2, 3], [2, 3, 3]]);
});

test("stops after the configured maximum attempts", () => {
  let attempts = 0;
  const result = runCommandWithRetries({
    label: "npm",
    maxAttempts: 2,
    run: () => {
      attempts += 1;
      return { status: 7 };
    },
    sleep: () => {},
  });
  assert.equal(result.status, 7);
  assert.equal(attempts, 2);
});

test("does not retry spawn errors", () => {
  let attempts = 0;
  const result = runCommandWithRetries({
    label: "npm",
    run: () => {
      attempts += 1;
      return { status: null, error: Object.assign(new Error("missing npm"), { code: "ENOENT" }) };
    },
    sleep: () => assert.fail("sleep should not run"),
  });
  assert.equal(result.error.code, "ENOENT");
  assert.equal(attempts, 1);
});

test("rejects invalid retry counts", () => {
  assert.throws(() => runCommandWithRetries({ label: "x", run: () => ({ status: 0 }), maxAttempts: 0 }), /positive integer/);
});
