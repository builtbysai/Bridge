import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyLockfileMode,
  extractJobContent,
  extractWorkflowRunCommands,
  hasExactExecutableLine,
  hasExactRunCommand,
  verifyWorkflowForLockfileMode,
} from "./verify-lockfile-mode.mjs";

const install = "npm ci --ignore-scripts --no-audit --no-fund";
const generate = "npm run lockfiles:generate";
const requirePresent = "npm run verify:committed-lockfiles -- --require-present";
const packageServerLockfile = "cp server/package-lock.json dist-server/package-lock.json";

const ciWorkflow = ({ validateGenerate = false, validateRequire = true } = {}) => `
jobs:
  lockfiles:
    steps:
      - run: ${generate}
  validate:
    steps:
      ${validateRequire ? `- run: ${requirePresent}` : ""}
      ${validateGenerate ? `- run: ${generate}` : ""}
      - run: ${install}
`;

const deployWorkflow = ({ generates = false, requires = true, packages = true } = {}) => `
jobs:
  build:
    steps:
      ${requires ? `- run: ${requirePresent}` : ""}
      ${generates ? `- run: ${generate}` : ""}
      - run: ${install}
      ${packages ? `- run: ${packageServerLockfile}` : ""}
`;

test("classifies absent and committed lockfile pairs", () => {
  assert.equal(classifyLockfileMode(false, false), "bootstrap");
  assert.equal(classifyLockfileMode(true, true), "committed");
});

test("rejects partial lockfile state", () => {
  assert.throws(() => classifyLockfileMode(true, false), /absent or committed as a pair/);
  assert.throws(() => classifyLockfileMode(false, true), /absent or committed as a pair/);
});

test("extracts exact commands from scalar and multiline run steps only", () => {
  const workflow = `
steps:
  - run: ${install}
  - run: |
      echo preparing
      ${generate}
      # ${packageServerLockfile}
  - name: Not a run command
    env:
      NOTE: ${generate}
`;
  assert.deepEqual(extractWorkflowRunCommands(workflow), [
    install,
    "echo preparing",
    generate,
  ]);
});

test("extracts one top-level workflow job without leaking adjacent job commands", () => {
  const workflow = ciWorkflow();
  const lockfiles = extractJobContent(workflow, "lockfiles");
  const validate = extractJobContent(workflow, "validate");
  assert.equal(hasExactRunCommand(lockfiles, generate), true);
  assert.equal(hasExactRunCommand(lockfiles, install), false);
  assert.equal(hasExactRunCommand(validate, generate), false);
  assert.equal(hasExactRunCommand(validate, install), true);
});

test("CI keeps registry generation isolated to the explicit handoff job", () => {
  assert.doesNotThrow(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge.yml",
    ciWorkflow(),
    "bootstrap",
  ));
  assert.doesNotThrow(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge.yml",
    ciWorkflow(),
    "committed",
  ));
  assert.throws(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge.yml",
    ciWorkflow({ validateGenerate: true }),
    "bootstrap",
  ), /validate must not regenerate lockfiles/);
});

test("CI validation requires the committed pair before npm ci", () => {
  assert.throws(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge.yml",
    ciWorkflow({ validateRequire: false }),
    "bootstrap",
  ), /must require the committed lockfile pair/);
});

test("deploy never regenerates lockfiles and always requires committed pair", () => {
  assert.doesNotThrow(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge-deploy.yml",
    deployWorkflow(),
    "bootstrap",
  ));
  assert.doesNotThrow(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge-deploy.yml",
    deployWorkflow(),
    "committed",
  ));
  assert.throws(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge-deploy.yml",
    deployWorkflow({ generates: true }),
    "bootstrap",
  ), /build must not regenerate lockfiles/);
  assert.throws(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge-deploy.yml",
    deployWorkflow({ requires: false }),
    "bootstrap",
  ), /must require the committed lockfile pair/);
});

test("deploy packaging must use the committed signaling runtime lockfile", () => {
  assert.throws(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge-deploy.yml",
    deployWorkflow({ packages: false }),
    "committed",
  ), /must package the committed signaling runtime lockfile/);
  assert.equal(hasExactExecutableLine(`      # ${packageServerLockfile}\n`, packageServerLockfile), false);
});

test("release job clean install cannot be satisfied by a wrapper command", () => {
  const workflow = deployWorkflow().replace(`- run: ${install}`, `- run: echo ${install}`);
  assert.throws(() => verifyWorkflowForLockfileMode(
    ".github/workflows/bridge-deploy.yml",
    workflow,
    "committed",
  ), /must install the reviewed build graph/);
});
