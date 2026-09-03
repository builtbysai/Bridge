import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

export function withIsolatedLockfileWorkspace({ bridgeRoot, runtimeRoot }, callback) {
  const directory = mkdtempSync(resolve(tmpdir(), "bridge-lockfiles-"));
  const userConfig = resolve(directory, ".npmrc");
  const stagedBridgeRoot = resolve(directory, "bridge");
  const stagedRuntimeRoot = resolve(stagedBridgeRoot, "server");

  try {
    mkdirSync(stagedRuntimeRoot, { recursive: true });
    copyFileSync(resolve(bridgeRoot, "package.json"), resolve(stagedBridgeRoot, "package.json"));
    copyFileSync(resolve(runtimeRoot, "package.json"), resolve(stagedRuntimeRoot, "package.json"));

    // Lockfile generation must not inherit a developer or runner ~/.npmrc. The
    // reviewed Bridge dependency graph is public and should be resolved without
    // private registry routing or credentials.
    writeFileSync(
      userConfig,
      `registry=${PUBLIC_REGISTRY}\nalways-auth=false\n`,
      { mode: 0o600 },
    );

    return callback({ directory, userConfig, stagedBridgeRoot, stagedRuntimeRoot });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
