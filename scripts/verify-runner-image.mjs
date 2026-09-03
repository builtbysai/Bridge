import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = bridgeRoot;
const WORKFLOWS = [".github/workflows/bridge.yml", ".github/workflows/bridge-deploy.yml"];
const REVIEWED_RUNNER = "ubuntu-24.04";

export function findUnreviewedRunnerImages(content, reviewedRunner = REVIEWED_RUNNER) {
  const runnerLines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.match(/^\s+runs-on:\s*([^\s#]+)\s*(?:#.*)?$/))
    .filter(Boolean)
    .map((match) => match[1]);

  if (runnerLines.length === 0) return ["<missing>"];
  return runnerLines.filter((runner) => runner !== reviewedRunner);
}

export function validateReviewedRunnerImage(content, workflow = "workflow") {
  const unreviewed = findUnreviewedRunnerImages(content);
  if (unreviewed.length > 0) {
    throw new Error(
      `${workflow} must run every explicit Bridge job on ${REVIEWED_RUNNER}; found ${unreviewed.join(", ")}.`,
    );
  }
}

function main() {
  let failed = false;
  for (const workflow of WORKFLOWS) {
    try {
      validateReviewedRunnerImage(readFileSync(resolve(repoRoot, workflow), "utf8"), workflow);
    } catch (error) {
      failed = true;
      console.error(`Bridge runner image policy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(`Bridge runner image policy passed: all Bridge CI/deploy jobs use reviewed runner image ${REVIEWED_RUNNER}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
