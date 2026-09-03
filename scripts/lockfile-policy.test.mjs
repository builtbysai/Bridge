import assert from "node:assert/strict";
import test from "node:test";
import { validateLockfilePolicy } from "./lockfile-policy.mjs";

const manifest = {
  name: "bridge-test",
  version: "0.1.0",
  dependencies: { ws: "8.21.1" },
  devDependencies: { vite: "7.3.6" }
};

const integrityForByte = (byte) => `sha512-${Buffer.alloc(64, byte).toString("base64")}`;

const validLockfile = () => ({
  name: manifest.name,
  version: manifest.version,
  lockfileVersion: 3,
  packages: {
    "": {
      name: manifest.name,
      version: manifest.version,
      dependencies: { ...manifest.dependencies },
      devDependencies: { ...manifest.devDependencies }
    },
    "node_modules/ws": {
      version: "8.21.1",
      resolved: "https://registry.npmjs.org/ws/-/ws-8.21.1.tgz",
      integrity: integrityForByte(0)
    },
    "node_modules/vite": {
      version: "7.3.6",
      resolved: "https://registry.npmjs.org/vite/-/vite-7.3.6.tgz",
      integrity: integrityForByte(1)
    }
  }
});

test("accepts reviewed registry packages with canonical sha512 integrity", () => {
  assert.deepEqual(validateLockfilePolicy(validLockfile(), manifest), []);
});

test("accepts canonical scoped registry tarballs", () => {
  const lockfile = validLockfile();
  lockfile.packages["node_modules/@scope/tool"] = {
    version: "1.2.3",
    resolved: "https://registry.npmjs.org/@scope/tool/-/tool-1.2.3.tgz",
    integrity: integrityForByte(2),
  };
  assert.deepEqual(validateLockfilePolicy(lockfile, manifest), []);
});

test("rejects dependency-map drift", () => {
  const lockfile = validLockfile();
  lockfile.packages[""].dependencies.ws = "8.18.0";
  assert.match(validateLockfilePolicy(lockfile, manifest).join("\n"), /dependencies does not exactly match/);
});

test("rejects credentials, non-registry URLs, and missing integrity", () => {
  const credentialed = validLockfile();
  credentialed.packages["node_modules/ws"].resolved = "https://token@registry.npmjs.org/ws/-/ws-8.21.1.tgz";
  assert.match(validateLockfilePolicy(credentialed, manifest).join("\n"), /without embedded credentials/);

  const external = validLockfile();
  external.packages["node_modules/ws"].resolved = "https://example.com/ws.tgz";
  assert.match(validateLockfilePolicy(external, manifest).join("\n"), /exact origin https:\/\/registry\.npmjs\.org/);

  const noIntegrity = validLockfile();
  delete noIntegrity.packages["node_modules/ws"].integrity;
  assert.match(validateLockfilePolicy(noIntegrity, manifest).join("\n"), /canonical 64-byte sha512 integrity metadata/);
});

test("rejects nonstandard registry ports, query parameters, and fragments", () => {
  for (const resolved of [
    "https://registry.npmjs.org:444/ws/-/ws-8.21.1.tgz",
    "https://registry.npmjs.org/ws/-/ws-8.21.1.tgz?token=ambient",
    "https://registry.npmjs.org/ws/-/ws-8.21.1.tgz#alternate",
  ]) {
    const lockfile = validLockfile();
    lockfile.packages["node_modules/ws"].resolved = resolved;
    assert.match(
      validateLockfilePolicy(lockfile, manifest).join("\n"),
      /exact origin https:\/\/registry\.npmjs\.org without embedded credentials, query parameters, or fragments/,
    );
  }
});

test("rejects registry tarballs that do not match package identity or version", () => {
  for (const resolved of [
    "https://registry.npmjs.org/vite/-/vite-8.21.1.tgz",
    "https://registry.npmjs.org/ws/-/ws-8.21.0.tgz",
    "https://registry.npmjs.org/ws/-/different-8.21.1.tgz",
  ]) {
    const lockfile = validLockfile();
    lockfile.packages["node_modules/ws"].resolved = resolved;
    assert.match(
      validateLockfilePolicy(lockfile, manifest).join("\n"),
      /canonical registry tarball for its package name and version/,
    );
  }
});

test("rejects truncated, non-canonical, and non-sha512 integrity metadata", () => {
  for (const integrity of [
    "sha512-QQ==",
    `sha512-${"B".repeat(86)}==`,
    `sha256-${Buffer.alloc(32).toString("base64")}`,
  ]) {
    const lockfile = validLockfile();
    lockfile.packages["node_modules/ws"].integrity = integrity;
    assert.match(
      validateLockfilePolicy(lockfile, manifest).join("\n"),
      /canonical 64-byte sha512 integrity metadata/,
    );
  }
});

test("rejects linked and unresolved packages", () => {
  const linked = validLockfile();
  linked.packages["node_modules/ws"] = { link: true };
  const errors = validateLockfilePolicy(linked, manifest).join("\n");
  assert.match(errors, /linked package/);
  assert.match(errors, /missing a resolved registry URL/);
});
