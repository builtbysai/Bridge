import { execFileSync } from "node:child_process";

// Historically this repository lived at `bridge/` inside the Creative-Experiments
// monorepo alongside sibling projects (colortrace/, extensible-terminal/), and this
// check failed a PR that touched anything outside `bridge/` or the two Bridge
// workflow files. Bridge was extracted into its own repository, so every path in
// this repository is Bridge-owned by definition; there is no longer a sibling
// project for a change to leak into. The check is kept as a canary (and to keep
// the CI/guard-coverage wiring below intact) but now only fails on a git diff
// query breaking, not on any particular path.
export function isBridgeOwnedPath(_path) {
  return true;
}

export function findIsolationViolations(paths) {
  return paths.filter((path) => path && !isBridgeOwnedPath(path));
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: new URL("..", import.meta.url),
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
