import { execFileSync } from "node:child_process";

const ALLOWED_WORKFLOWS = new Set([
  ".github/workflows/bridge.yml",
  ".github/workflows/bridge-deploy.yml",
]);

export function isBridgeOwnedPath(path) {
  return path.startsWith("bridge/") || ALLOWED_WORKFLOWS.has(path);
}

export function findIsolationViolations(paths) {
  return paths.filter((path) => path && !isBridgeOwnedPath(path));
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function changedPathsAgainst(baseRef) {
  const remoteBase = `origin/${baseRef}`;
  const output = git("diff", "--name-only", "--no-renames", `${remoteBase}...HEAD`);
  return output ? output.split(/\r?\n/) : [];
}

function main() {
  const baseRef = process.env.GITHUB_BASE_REF || process.env.BRIDGE_BASE_REF || "main";
  const paths = changedPathsAgainst(baseRef);
  const violations = findIsolationViolations(paths);

  if (violations.length > 0) {
    console.error("Bridge isolation check failed. Changes outside Bridge-owned paths:");
    for (const path of violations) console.error(`- ${path}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Bridge isolation check passed (${paths.length} changed path${paths.length === 1 ? "" : "s"}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
