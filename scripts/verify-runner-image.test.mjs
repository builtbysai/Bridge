import assert from "node:assert/strict";
import test from "node:test";

import { findUnreviewedRunnerImages, validateReviewedRunnerImage } from "./verify-runner-image.mjs";

test("runner policy accepts every explicit job on the reviewed Ubuntu image", () => {
  const workflow = `
jobs:
  test:
    runs-on: ubuntu-24.04
  build:
    runs-on: ubuntu-24.04 # reviewed release image
`;

  assert.deepEqual(findUnreviewedRunnerImages(workflow), []);
  assert.doesNotThrow(() => validateReviewedRunnerImage(workflow, "bridge.yml"));
});

test("runner policy rejects mutable latest aliases and mixed runner images", () => {
  const workflow = `
jobs:
  test:
    runs-on: ubuntu-latest
  build:
    runs-on: ubuntu-24.04
  mac:
    runs-on: macos-latest
`;

  assert.deepEqual(findUnreviewedRunnerImages(workflow), ["ubuntu-latest", "macos-latest"]);
  assert.throws(() => validateReviewedRunnerImage(workflow, "bridge.yml"), /ubuntu-latest, macos-latest/);
});

test("runner policy fails closed when no explicit runs-on declaration exists", () => {
  assert.deepEqual(findUnreviewedRunnerImages("jobs:\n  test:\n    steps: []\n"), ["<missing>"]);
  assert.throws(() => validateReviewedRunnerImage("jobs:\n  test:\n    steps: []\n"), /<missing>/);
});
