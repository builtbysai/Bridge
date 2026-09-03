import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLockfilePolicy } from "./lockfile-policy.mjs";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function validateCommittedLockfilePair({ rootLockfile, serverLockfile, rootManifest, serverManifest, requirePresent = false }) {
  if ((rootLockfile == null) !== (serverLockfile == null)) {
    return ["Bridge lockfiles must be absent or committed as a pair; partial lockfile state is forbidden."];
  }

  if (rootLockfile == null && serverLockfile == null) {
    return requirePresent
      ? ["Bridge release artifacts require the reviewed root and signaling lockfiles to be committed as a pair."]
      : [];
  }

  return [
    ...validateLockfilePolicy(rootLockfile, rootManifest, "Bridge root"),
    ...validateLockfilePolicy(serverLockfile, serverManifest, "Bridge signaling runtime"),
  ];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const requirePresent = process.argv.slice(2).includes("--require-present");
  const rootLockPath = resolve(bridgeRoot, "package-lock.json");
  const serverLockPath = resolve(bridgeRoot, "server/package-lock.json");
  const rootExists = existsSync(rootLockPath);
  const serverExists = existsSync(serverLockPath);

  const errors = validateCommittedLockfilePair({
    rootLockfile: rootExists ? readJson(rootLockPath) : null,
    serverLockfile: serverExists ? readJson(serverLockPath) : null,
    rootManifest: readJson(resolve(bridgeRoot, "package.json")),
    serverManifest: readJson(resolve(bridgeRoot, "server/package.json")),
    requirePresent,
  });

  if (errors.length > 0) {
    for (const error of errors) console.error(`Bridge committed lockfile verification failed: ${error}`);
    process.exitCode = 1;
    return;
  }

  if (!rootExists && !serverExists) {
    console.log("Bridge committed lockfile verification passed in bootstrap mode: no repository lockfile pair is present yet.");
    return;
  }

  console.log("Bridge committed lockfile verification passed: both repository lockfiles satisfy the reviewed registry and integrity policy.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
