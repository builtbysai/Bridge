import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEWED_NODE_VERSION,
  REVIEWED_NPM_VERSION,
  validatePackageToolchain,
  validateWorkflowToolchain,
  workflowToolchainViolations,
} from "./verify-toolchain-policy.mjs";

function packageJson(overrides = {}) {
  return {
    packageManager: `npm@${REVIEWED_NPM_VERSION}`,
    engines: { node: ">=22 <23" },
    ...overrides,
  };
}

function workflow(nodeVersions) {
  const jobs = nodeVersions
    .map(
      (version, index) => `  job${index + 1}:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/setup-node@0123456789012345678901234567890123456789\n        with:\n          node-version: ${version}`,
    )
    .join("\n");
  return `name: test\non:\n  workflow_dispatch:\njobs:\n${jobs}\n`;
}

test("accepts the reviewed package manager and Node engine range", () => {
  assert.doesNotThrow(() => validatePackageToolchain(packageJson()));
});

test("rejects npm resolver drift", () => {
  assert.throws(
    () => validatePackageToolchain(packageJson({ packageManager: "npm@11.0.0" })),
    /npm@10\.9\.8/,
  );
});

test("rejects Node engine policy drift", () => {
  assert.throws(
    () => validatePackageToolchain(packageJson({ engines: { node: ">=22" } })),
    /reviewed Node engine range/,
  );
});

test("accepts one exact reviewed Node pin per workflow job", () => {
  assert.doesNotThrow(() => validateWorkflowToolchain(workflow([REVIEWED_NODE_VERSION, REVIEWED_NODE_VERSION])));
});

test("rejects a floating or different Node release", () => {
  assert.throws(() => validateWorkflowToolchain(workflow(["22"])), /reviewed Node 22\.23\.2/);
});

test("rejects jobs without their own setup-node pin", () => {
  const content = `${workflow([REVIEWED_NODE_VERSION])}  second:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: node --version\n`;
  assert.match(workflowToolchainViolations(content).join("\n"), /one setup-node version per runner-backed job/);
});
