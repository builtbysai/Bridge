import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(bridgeRoot, "..");
const WORKFLOWS = new Map([
  [".github/workflows/bridge.yml", /^bridge-ci-\$\{\{ github\.ref \}\}$/],
  [".github/workflows/bridge-deploy.yml", /^bridge-deploy-production$/],
]);

export function extractTopLevelConcurrency(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^concurrency:\s*(?:#.*)?$/.test(lines[index])) continue;

    const block = [];
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      if (/^\S/.test(lines[inner])) break;
      block.push(lines[inner]);
    }
    blocks.push(block);
  }

  return blocks;
}

export function validateWorkflowConcurrency(content, expectedGroup) {
  const blocks = extractTopLevelConcurrency(content);
  if (blocks.length === 0) return ["workflow must define top-level concurrency"];
  if (blocks.length > 1) return ["workflow must define top-level concurrency exactly once"];

  const groupValues = blocks[0]
    .map((line) => line.match(/^  group:\s*(.+?)\s*(?:#.*)?$/))
    .filter(Boolean)
    .map((match) => match[1]);
  const cancelValues = blocks[0]
    .map((line) => line.match(/^  cancel-in-progress:\s*(true|false)\s*(?:#.*)?$/))
    .filter(Boolean)
    .map((match) => match[1]);
  const errors = [];

  if (groupValues.length !== 1) {
    errors.push("concurrency must define group exactly once");
  } else if (!expectedGroup.test(groupValues[0])) {
    errors.push(`concurrency group is not the reviewed value: ${groupValues[0]}`);
  }

  if (cancelValues.length !== 1) {
    errors.push("concurrency must define cancel-in-progress exactly once");
  } else if (cancelValues[0] !== "true") {
    errors.push("concurrency cancel-in-progress must be true");
  }

  return errors;
}

function main() {
  let failed = false;
  for (const [workflow, expectedGroup] of WORKFLOWS) {
    const content = readFileSync(resolve(repoRoot, workflow), "utf8");
    for (const error of validateWorkflowConcurrency(content, expectedGroup)) {
      console.error(`Bridge workflow concurrency policy failed: ${workflow}: ${error}.`);
      failed = true;
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Bridge workflow concurrency policy passed: CI/deploy runs use reviewed groups and cancel superseded in-progress work.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
