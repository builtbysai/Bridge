import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = bridgeRoot;
const WORKFLOWS = [".github/workflows/bridge.yml", ".github/workflows/bridge-deploy.yml"];

export function extractWorkflowJobs(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const jobs = [];
  let inJobs = false;
  let current = null;

  for (const line of lines) {
    if (!inJobs) {
      if (/^jobs:\s*(?:#.*)?$/.test(line)) inJobs = true;
      continue;
    }

    if (/^\S/.test(line)) break;

    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (jobMatch) {
      if (current) jobs.push(current);
      current = { name: jobMatch[1], lines: [] };
      continue;
    }

    if (current) current.lines.push(line);
  }

  if (current) jobs.push(current);
  return jobs;
}

export function validateWorkflowJobTimeouts(content, { min = 1, max = 60 } = {}) {
  const jobs = extractWorkflowJobs(content);
  const errors = [];

  if (jobs.length === 0) return ["workflow must define at least one explicit job"];

  for (const job of jobs) {
    const timeoutValues = job.lines
      .map((line) => line.match(/^    timeout-minutes:\s*(\d+)\s*(?:#.*)?$/))
      .filter(Boolean)
      .map((match) => Number(match[1]));

    if (timeoutValues.length === 0) {
      errors.push(`job ${job.name} must define timeout-minutes`);
      continue;
    }
    if (timeoutValues.length > 1) {
      errors.push(`job ${job.name} must define timeout-minutes exactly once`);
      continue;
    }

    const timeout = timeoutValues[0];
    if (!Number.isInteger(timeout) || timeout < min || timeout > max) {
      errors.push(`job ${job.name} timeout-minutes must be between ${min} and ${max}, found ${timeout}`);
    }
  }

  return errors;
}

function main() {
  let failed = false;
  for (const workflow of WORKFLOWS) {
    const content = readFileSync(resolve(repoRoot, workflow), "utf8");
    for (const error of validateWorkflowJobTimeouts(content)) {
      console.error(`Bridge workflow timeout policy failed: ${workflow}: ${error}.`);
      failed = true;
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Bridge workflow timeout policy passed: every Bridge CI/deploy job has exactly one bounded timeout-minutes value.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
