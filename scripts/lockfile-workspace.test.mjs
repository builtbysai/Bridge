import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { withIsolatedLockfileWorkspace } from "./lockfile-workspace.mjs";

function makeFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "bridge-lockfile-workspace-test-"));
  const bridgeRoot = resolve(root, "bridge");
  const runtimeRoot = resolve(bridgeRoot, "server");
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(resolve(bridgeRoot, "package.json"), '{"name":"bridge-test"}\n');
  writeFileSync(resolve(runtimeRoot, "package.json"), '{"name":"bridge-runtime-test"}\n');
  return { root, bridgeRoot, runtimeRoot };
}

test("isolated lockfile workspace is removed after success", () => {
  const fixture = makeFixture();
  let workspaceDirectory;
  try {
    const value = withIsolatedLockfileWorkspace(fixture, ({ directory, userConfig }) => {
      workspaceDirectory = directory;
      assert.equal(existsSync(userConfig), true);
      return "done";
    });
    assert.equal(value, "done");
    assert.equal(existsSync(workspaceDirectory), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("isolated lockfile workspace is removed when generation throws", () => {
  const fixture = makeFixture();
  let workspaceDirectory;
  try {
    assert.throws(
      () => withIsolatedLockfileWorkspace(fixture, ({ directory }) => {
        workspaceDirectory = directory;
        throw new Error("simulated npm failure");
      }),
      /simulated npm failure/,
    );
    assert.equal(existsSync(workspaceDirectory), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
