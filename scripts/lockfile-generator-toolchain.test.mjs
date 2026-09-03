import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEWED_NODE_VERSION,
  REVIEWED_NPM_VERSION,
  validateLockfileGeneratorToolchain,
} from "./lockfile-generator-toolchain.mjs";

test("accepts the reviewed lockfile generator toolchain", () => {
  assert.deepEqual(
    validateLockfileGeneratorToolchain({
      nodeVersion: REVIEWED_NODE_VERSION,
      npmVersion: REVIEWED_NPM_VERSION,
    }),
    [],
  );
});

test("rejects another Node 22 release", () => {
  assert.deepEqual(
    validateLockfileGeneratorToolchain({
      nodeVersion: "v22.22.0",
      npmVersion: REVIEWED_NPM_VERSION,
    }),
    [
      `lockfile generation requires Node ${REVIEWED_NODE_VERSION}; current runtime is v22.22.0.`,
    ],
  );
});

test("rejects another npm resolver release", () => {
  assert.deepEqual(
    validateLockfileGeneratorToolchain({
      nodeVersion: REVIEWED_NODE_VERSION,
      npmVersion: "10.9.7",
    }),
    [
      `lockfile generation requires npm ${REVIEWED_NPM_VERSION}; current npm is 10.9.7.`,
    ],
  );
});

test("reports Node and npm drift together", () => {
  assert.deepEqual(
    validateLockfileGeneratorToolchain({
      nodeVersion: "v22.24.0",
      npmVersion: "11.0.0",
    }),
    [
      `lockfile generation requires Node ${REVIEWED_NODE_VERSION}; current runtime is v22.24.0.`,
      `lockfile generation requires npm ${REVIEWED_NPM_VERSION}; current npm is 11.0.0.`,
    ],
  );
});
