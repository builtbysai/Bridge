import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./verify-release-artifact-contents.mjs", import.meta.url);

const makeFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-artifact-policy-"));
  await mkdir(path.join(root, "dist", "assets"), { recursive: true });
  await mkdir(path.join(root, "dist-server"), { recursive: true });
  const files = {
    "dist/index.html": "<!doctype html><title>Bridge</title>",
    "dist/manifest.webmanifest": "{}",
    "dist/sw.js": "self.addEventListener('fetch', () => {});",
    "dist/_headers": "/*\n  X-Content-Type-Options: nosniff\n",
    "dist/assets/app.js": "console.log('bridge');",
    "dist-server/signaling.js": "export {};",
    "dist-server/package.json": JSON.stringify({ name: "bridge-signaling-runtime", private: true, type: "module", scripts: { start: "node signaling.js" }, dependencies: { ws: "8.21.1" } }),
    "dist-server/package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
    "dist-server/bridge-runtime.cdx.json": "{}",
    "bridge-dependencies.cdx.json": "{}",
    "bridge-artifacts.sha256": "placeholder\n"
  };
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, file), content);
  return root;
};

const run = root => spawnSync(process.execPath, [script.pathname, "--root", root], { encoding: "utf8" });

test("accepts the expected frontend and minimal signaling artifact", async () => {
  const root = await makeFixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /content policy passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects source maps and environment files", async () => {
  for (const [file, expected] of [["dist/assets/app.js.map", "forbidden source/secret extension"], ["dist/.env.production.local", "environment/config secret material"]]) {
    const root = await makeFixture();
    try {
      await writeFile(path.join(root, file), "secret-ish");
      const result = run(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(expected));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects tests and node_modules from the packaged runtime", async () => {
  const root = await makeFixture();
  try {
    await writeFile(path.join(root, "dist-server", "signaling.test.js"), "export {};" );
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /test\/spec material/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const rootWithModules = await makeFixture();
  try {
    await mkdir(path.join(rootWithModules, "dist-server", "node_modules", "ws"), { recursive: true });
    await writeFile(path.join(rootWithModules, "dist-server", "node_modules", "ws", "index.js"), "module.exports = {};" );
    const result = run(rootWithModules);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not contain node_modules/);
  } finally {
    await rm(rootWithModules, { recursive: true, force: true });
  }
});

test("rejects symlinks and unreviewed runtime package scripts", async () => {
  const root = await makeFixture();
  try {
    await symlink("app.js", path.join(root, "dist", "assets", "alias.js"));
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not contain symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const rootWithScript = await makeFixture();
  try {
    await writeFile(path.join(rootWithScript, "dist-server", "package.json"), JSON.stringify({ name: "bridge-signaling-runtime", private: true, scripts: { start: "node signaling.js", postinstall: "echo nope" }, dependencies: { ws: "8.21.1" } }));
    const result = run(rootWithScript);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /scripts must contain only the reviewed start command/);
  } finally {
    await rm(rootWithScript, { recursive: true, force: true });
  }
});
