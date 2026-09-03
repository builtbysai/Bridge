import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(bridgeRoot, "..");

export const REVIEWED_WORKFLOWS = [
  ".github/workflows/bridge.yml",
  ".github/workflows/bridge-deploy.yml",
];

export const REQUIRED_GUARD_COMMANDS = [
  "node scripts/verify-isolation.mjs",
  "npm run verify:workflow-permissions",
  "npm run verify:workflow-concurrency",
  "npm run verify:checkout-credentials",
  "npm run verify:runner-image",
  "npm run verify:toolchain",
  "npm run verify:workflow-jobs",
  "npm run verify:artifact-retention",
  "npm run verify:lockfile-mode",
  "npm run verify:committed-lockfiles",
  "npm run verify:supply-chain",
  "node scripts/release-preflight.mjs",
  "npm run verify:production-origin",
  "npm run test:lockfile-policy",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasExactRunCommand(content, command) {
  const commandPattern = escapeRegExp(command);
  return new RegExp(`^\\s*run:\\s*${commandPattern}\\s*$`, "m").test(content);
}

export function findMissingWorkflowGuards(content) {
  return REQUIRED_GUARD_COMMANDS.filter((command) => !hasExactRunCommand(content, command));
}

export function verifyWorkflowGuardCoverage(workflow, content) {
  const missing = findMissingWorkflowGuards(content);
  if (missing.length === 0) return;

  throw new Error(
    `${workflow} is missing required Bridge guard command${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
  );
}

function main() {
  let failed = false;

  for (const workflow of REVIEWED_WORKFLOWS) {
    const content = readFileSync(resolve(repoRoot, workflow), "utf8");
    try {
      verifyWorkflowGuardCoverage(workflow, content);
    } catch (error) {
      failed = true;
      console.error(`Bridge workflow guard coverage failed: ${error.message}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log("Bridge workflow guard coverage passed: both reviewed workflows retain every repository-side policy guard.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
