import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLockfilePolicy } from "./lockfile-policy.mjs";
import { publishLockfilePair } from "./lockfile-publication.mjs";
import { withIsolatedLockfileWorkspace } from "./lockfile-workspace.mjs";
import { sanitizeNpmEnvironment } from "./npm-environment.mjs";
import { requireReviewedLockfileGeneratorToolchain } from "./lockfile-generator-toolchain.mjs";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = resolve(bridgeRoot, "server");
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

function fail(message) {
  throw new Error(message);
}

function generate(cwd, label, userConfig) {
  console.log(`Generating ${label} package-lock.json from the public npm registry...`);
  const result = spawnSync(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `--registry=${PUBLIC_REGISTRY}`,
      `--userconfig=${userConfig}`,
    ],
    {
      cwd,
      env: {
        ...sanitizeNpmEnvironment(process.env),
        npm_config_package_lock: "true",
        npm_config_save_exact: "true",
        npm_config_engine_strict: "true",
      },
      stdio: "inherit",
    },
  );

  if (result.error) fail(`${label} npm invocation could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} npm install exited with status ${result.status}.`);
}

function validateLockfile(cwd, manifestPath, label) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const lockfilePath = resolve(cwd, "package-lock.json");
  const lockfileBytes = readFileSync(lockfilePath);
  const lockfile = JSON.parse(lockfileBytes.toString("utf8"));
  const errors = validateLockfilePolicy(lockfile, manifest, label);
  if (errors.length > 0) fail(errors.join("\n"));
  return createHash("sha256").update(lockfileBytes).digest("hex");
}

try {
  requireReviewedLockfileGeneratorToolchain();
  withIsolatedLockfileWorkspace({ bridgeRoot, runtimeRoot }, ({ userConfig, stagedBridgeRoot, stagedRuntimeRoot }) => {
    generate(stagedBridgeRoot, "Bridge development/build", userConfig);
    generate(stagedRuntimeRoot, "Bridge signaling runtime", userConfig);

    // Validate both staged graphs against the reviewed repository manifests before
    // publishing either lockfile. The exact bytes validated are SHA-256 bound to
    // publication so a staged path cannot silently change between policy review and
    // repository replacement. Publication also rolls both destinations back if a
    // later replacement fails.
    const bridgeSha256 = validateLockfile(
      stagedBridgeRoot,
      resolve(bridgeRoot, "package.json"),
      "Bridge development/build",
    );
    const runtimeSha256 = validateLockfile(
      stagedRuntimeRoot,
      resolve(runtimeRoot, "package.json"),
      "Bridge signaling runtime",
    );

    publishLockfilePair([
      {
        stagedPath: resolve(stagedBridgeRoot, "package-lock.json"),
        destinationPath: resolve(bridgeRoot, "package-lock.json"),
        expectedSha256: bridgeSha256,
      },
      {
        stagedPath: resolve(stagedRuntimeRoot, "package-lock.json"),
        destinationPath: resolve(runtimeRoot, "package-lock.json"),
        expectedSha256: runtimeSha256,
      },
    ]);
  });
} catch (error) {
  console.error(`Bridge lockfile generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log("Bridge lockfiles generated with the reviewed Node v22.23.2/npm 10.9.8 toolchain, policy-validated, SHA-256 bound to the exact validated bytes, and rollback-safe published only after both staged dependency graphs passed validation. Generation uses an isolated npm configuration and sanitized process environment pinned to credential-free registry.npmjs.org; root dependency maps match the reviewed manifests, every resolved package uses credential-free HTTPS registry.npmjs.org provenance, and registry packages carry canonical sha512 integrity metadata. Review and commit package-lock.json and server/package-lock.json together, then switch CI/deploy installs to committed-lockfile npm ci.");
}
