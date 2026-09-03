import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { publishLockfilePair } from "./lockfile-publication.mjs";

function workspace() {
  return mkdtempSync(resolve(tmpdir(), "bridge-lockfile-publication-test-"));
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function entry(stagedPath, destinationPath, content) {
  return { stagedPath, destinationPath, expectedSha256: sha256(content) };
}

test("publishes both validated lockfiles together", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "root-next");
  writeFileSync(stagedRuntime, "runtime-next");
  writeFileSync(rootLock, "root-old");
  writeFileSync(runtimeLock, "runtime-old");

  publishLockfilePair([
    entry(stagedRoot, rootLock, "root-next"),
    entry(stagedRuntime, runtimeLock, "runtime-next"),
  ]);

  assert.equal(readFileSync(rootLock, "utf8"), "root-next");
  assert.equal(readFileSync(runtimeLock, "utf8"), "runtime-next");
  assert.deepEqual(readdirSync(root).sort(), [
    "package-lock.json",
    "server-package-lock.json",
    "staged-root.json",
    "staged-runtime.json",
  ]);
});

test("fails before publication when either staged lockfile is missing", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const missingRuntime = resolve(root, "missing-runtime.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "root-next");
  writeFileSync(rootLock, "root-old");
  writeFileSync(runtimeLock, "runtime-old");

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, rootLock, "root-next"),
    entry(missingRuntime, runtimeLock, "runtime-next"),
  ]), { code: "ENOENT" });

  assert.equal(readFileSync(rootLock, "utf8"), "root-old");
  assert.equal(readFileSync(runtimeLock, "utf8"), "runtime-old");
});

test("does not create a destination when staged preflight fails", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const missingRuntime = resolve(root, "missing-runtime.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "root-next");

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, rootLock, "root-next"),
    entry(missingRuntime, runtimeLock, "runtime-next"),
  ]), { code: "ENOENT" });

  assert.throws(() => readFileSync(rootLock, "utf8"), { code: "ENOENT" });
  assert.throws(() => readFileSync(runtimeLock, "utf8"), { code: "ENOENT" });
});

test("rejects a symlinked staged lockfile", () => {
  const root = workspace();
  const realStagedRoot = resolve(root, "real-staged-root.json");
  const stagedRootLink = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(realStagedRoot, "root-next");
  symlinkSync(realStagedRoot, stagedRootLink);
  writeFileSync(stagedRuntime, "runtime-next");

  assert.throws(() => publishLockfilePair([
    entry(stagedRootLink, rootLock, "root-next"),
    entry(stagedRuntime, runtimeLock, "runtime-next"),
  ]), /Staged lockfile 1 must be a regular file/);

  assert.throws(() => readFileSync(rootLock, "utf8"), { code: "ENOENT" });
  assert.throws(() => readFileSync(runtimeLock, "utf8"), { code: "ENOENT" });
});

test("rejects a symlinked destination without modifying its target", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const externalTarget = resolve(root, "outside-target.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "root-next");
  writeFileSync(stagedRuntime, "runtime-next");
  writeFileSync(externalTarget, "outside-old");
  symlinkSync(externalTarget, rootLock);

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, rootLock, "root-next"),
    entry(stagedRuntime, runtimeLock, "runtime-next"),
  ]), /Destination lockfile 1 must be a regular file/);

  assert.equal(readFileSync(externalTarget, "utf8"), "outside-old");
  assert.throws(() => readFileSync(runtimeLock, "utf8"), { code: "ENOENT" });
});

test("rejects staged bytes that changed after policy validation", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "root-mutated");
  writeFileSync(stagedRuntime, "runtime-next");
  writeFileSync(rootLock, "root-old");
  writeFileSync(runtimeLock, "runtime-old");

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, rootLock, "root-validated"),
    entry(stagedRuntime, runtimeLock, "runtime-next"),
  ]), /changed after policy validation/);

  assert.equal(readFileSync(rootLock, "utf8"), "root-old");
  assert.equal(readFileSync(runtimeLock, "utf8"), "runtime-old");
  assert.deepEqual(readdirSync(root).sort(), [
    "package-lock.json",
    "server-package-lock.json",
    "staged-root.json",
    "staged-runtime.json",
  ]);
});

test("rejects duplicate destination paths before publication", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const destination = resolve(root, "package-lock.json");
  writeFileSync(stagedRoot, "root-next");
  writeFileSync(stagedRuntime, "runtime-next");
  writeFileSync(destination, "old");

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, destination, "root-next"),
    entry(stagedRuntime, resolve(root, "nested", "..", "package-lock.json"), "runtime-next"),
  ]), /requires two distinct staged paths and two distinct destination paths/);

  assert.equal(readFileSync(destination, "utf8"), "old");
});

test("rejects staged and destination path overlap before publication", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "root-next");
  writeFileSync(stagedRuntime, "runtime-next");

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, stagedRuntime, "root-next"),
    entry(stagedRuntime, runtimeLock, "runtime-next"),
  ]), /requires two distinct staged paths and two distinct destination paths/);

  assert.equal(readFileSync(stagedRuntime, "utf8"), "runtime-next");
  assert.throws(() => readFileSync(runtimeLock, "utf8"), { code: "ENOENT" });
});

test("rejects hard-linked staged lockfiles before publication", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "same-bytes");
  linkSync(stagedRoot, stagedRuntime);

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, rootLock, "same-bytes"),
    entry(stagedRuntime, runtimeLock, "same-bytes"),
  ]), /must not be hard-link aliases/);

  assert.throws(() => readFileSync(rootLock, "utf8"), { code: "ENOENT" });
  assert.throws(() => readFileSync(runtimeLock, "utf8"), { code: "ENOENT" });
});

test("rejects hard-linked destination lockfiles before publication", () => {
  const root = workspace();
  const stagedRoot = resolve(root, "staged-root.json");
  const stagedRuntime = resolve(root, "staged-runtime.json");
  const rootLock = resolve(root, "package-lock.json");
  const runtimeLock = resolve(root, "server-package-lock.json");
  writeFileSync(stagedRoot, "root-next");
  writeFileSync(stagedRuntime, "runtime-next");
  writeFileSync(rootLock, "shared-old");
  linkSync(rootLock, runtimeLock);

  assert.throws(() => publishLockfilePair([
    entry(stagedRoot, rootLock, "root-next"),
    entry(stagedRuntime, runtimeLock, "runtime-next"),
  ]), /must not be hard-link aliases/);

  assert.equal(readFileSync(rootLock, "utf8"), "shared-old");
  assert.equal(readFileSync(runtimeLock, "utf8"), "shared-old");
});
