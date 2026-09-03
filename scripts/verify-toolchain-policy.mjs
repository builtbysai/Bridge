import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = bridgeRoot;

export const REVIEWED_NODE_VERSION = "22.23.2";
export const REVIEWED_NPM_VERSION = "10.9.8";
export const REVIEWED_NODE_ENGINE = ">=22 <23";
export const REVIEWED_WORKFLOWS = [
  ".github/workflows/bridge.yml",
  ".github/workflows/bridge-deploy.yml",
];

export function validatePackageToolchain(packageJson) {
  if (packageJson.packageManager !== `npm@${REVIEWED_NPM_VERSION}`) {
    throw new Error(
      `package.json must pin packageManager to npm@${REVIEWED_NPM_VERSION}; found ${JSON.stringify(packageJson.packageManager)}.`,
    );
  }

  if (packageJson.engines?.node !== REVIEWED_NODE_ENGINE) {
    throw new Error(
      `package.json must keep the reviewed Node engine range ${JSON.stringify(REVIEWED_NODE_ENGINE)}; found ${JSON.stringify(packageJson.engines?.node)}.`,
    );
  }
}

export function workflowToolchainViolations(content, workflow = "workflow") {
  const normalized = content.replace(/\r\n/g, "\n");
  const jobCount = [...normalized.matchAll(/^\s+runs-on:\s*[^\s#]+\s*(?:#.*)?$/gm)].length;
  const nodeVersions = [...normalized.matchAll(/^\s+node-version:\s*['"]?([^\s'"#]+)['"]?\s*(?:#.*)?$/gm)].map(
    (match) => match[1],
  );

  const violations = [];
  if (jobCount === 0) violations.push(`${workflow} must declare at least one explicit runner-backed job.`);
  if (nodeVersions.length !== jobCount) {
    violations.push(
      `${workflow} must pin one setup-node version per runner-backed job; found ${nodeVersions.length} node-version entries for ${jobCount} jobs.`,
    );
  }

  for (const version of nodeVersions) {
    if (version !== REVIEWED_NODE_VERSION) {
      violations.push(
        `${workflow} must use reviewed Node ${REVIEWED_NODE_VERSION}; found node-version ${JSON.stringify(version)}.`,
      );
    }
  }

  return violations;
}

export function validateWorkflowToolchain(content, workflow = "workflow") {
  const violations = workflowToolchainViolations(content, workflow);
  if (violations.length > 0) throw new Error(violations.join(" "));
}

function main() {
  let failed = false;

  try {
    validatePackageToolchain(JSON.parse(readFileSync(resolve(bridgeRoot, "package.json"), "utf8")));
  } catch (error) {
    failed = true;
    console.error(`Bridge toolchain policy failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const workflow of REVIEWED_WORKFLOWS) {
    try {
      validateWorkflowToolchain(readFileSync(resolve(repoRoot, workflow), "utf8"), workflow);
    } catch (error) {
      failed = true;
      console.error(`Bridge toolchain policy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(
      `Bridge toolchain policy passed: Node ${REVIEWED_NODE_VERSION} and npm ${REVIEWED_NPM_VERSION} are pinned across package and workflow boundaries.`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
