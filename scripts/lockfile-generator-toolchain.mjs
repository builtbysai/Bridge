import { spawnSync } from "node:child_process";

export const REVIEWED_NODE_VERSION = "v22.23.2";
export const REVIEWED_NPM_VERSION = "10.9.8";

export function validateLockfileGeneratorToolchain({ nodeVersion, npmVersion }) {
  const errors = [];

  if (nodeVersion !== REVIEWED_NODE_VERSION) {
    errors.push(
      `lockfile generation requires Node ${REVIEWED_NODE_VERSION}; current runtime is ${nodeVersion}.`,
    );
  }

  if (npmVersion !== REVIEWED_NPM_VERSION) {
    errors.push(
      `lockfile generation requires npm ${REVIEWED_NPM_VERSION}; current npm is ${npmVersion}.`,
    );
  }

  return errors;
}

export function readNpmVersion({ env = process.env } = {}) {
  const result = spawnSync("npm", ["--version"], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`unable to execute npm --version: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim();
    throw new Error(
      `npm --version exited with status ${result.status}${detail ? `: ${detail}` : "."}`,
    );
  }

  const version = String(result.stdout ?? "").trim();
  if (!version) {
    throw new Error("npm --version returned an empty version string.");
  }
  return version;
}

export function requireReviewedLockfileGeneratorToolchain({
  nodeVersion = process.version,
  npmVersion = readNpmVersion(),
} = {}) {
  const errors = validateLockfileGeneratorToolchain({ nodeVersion, npmVersion });
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
