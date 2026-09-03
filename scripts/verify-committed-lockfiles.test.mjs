import assert from "node:assert/strict";
import test from "node:test";

import { validateCommittedLockfilePair } from "./verify-committed-lockfiles.mjs";

const integrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

const rootManifest = {
  name: "bridge-device-transfer",
  version: "0.1.0",
  dependencies: { ws: "8.21.1" },
  devDependencies: {},
};
const serverManifest = {
  name: "bridge-signaling-runtime",
  version: "0.1.0",
  dependencies: { ws: "8.21.1" },
};

function makeLockfile(manifest) {
  return {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: manifest.name,
        version: manifest.version,
        dependencies: manifest.dependencies ?? {},
        devDependencies: manifest.devDependencies ?? {},
      },
      "node_modules/ws": {
        version: "8.21.1",
        resolved: "https://registry.npmjs.org/ws/-/ws-8.21.1.tgz",
        integrity,
      },
    },
  };
}

test("bootstrap mode accepts an absent pair", () => {
  assert.deepEqual(validateCommittedLockfilePair({ rootLockfile: null, serverLockfile: null, rootManifest, serverManifest }), []);
});

test("release mode rejects an absent pair", () => {
  const errors = validateCommittedLockfilePair({
    rootLockfile: null,
    serverLockfile: null,
    rootManifest,
    serverManifest,
    requirePresent: true,
  });
  assert.deepEqual(errors, ["Bridge release artifacts require the reviewed root and signaling lockfiles to be committed as a pair."]);
});

test("partial committed state fails closed", () => {
  const errors = validateCommittedLockfilePair({
    rootLockfile: makeLockfile(rootManifest),
    serverLockfile: null,
    rootManifest,
    serverManifest,
    requirePresent: true,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /committed as a pair/);
});

test("valid committed pair satisfies provenance policy", () => {
  assert.deepEqual(validateCommittedLockfilePair({
    rootLockfile: makeLockfile(rootManifest),
    serverLockfile: makeLockfile(serverManifest),
    rootManifest,
    serverManifest,
    requirePresent: true,
  }), []);
});

test("off-registry committed dependency is rejected", () => {
  const badRoot = makeLockfile(rootManifest);
  badRoot.packages["node_modules/ws"].resolved = "https://mirror.example.test/ws-8.21.1.tgz";

  const errors = validateCommittedLockfilePair({
    rootLockfile: badRoot,
    serverLockfile: makeLockfile(serverManifest),
    rootManifest,
    serverManifest,
  });
  assert.ok(errors.some(error => /exact origin https:\/\/registry\.npmjs\.org/.test(error)));
});

test("malformed committed integrity metadata is rejected", () => {
  const badServer = makeLockfile(serverManifest);
  badServer.packages["node_modules/ws"].integrity = "sha512-Zm9v";

  const errors = validateCommittedLockfilePair({
    rootLockfile: makeLockfile(rootManifest),
    serverLockfile: badServer,
    rootManifest,
    serverManifest,
  });
  assert.ok(errors.some(error => /canonical 64-byte sha512 integrity/.test(error)));
});
