import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = bridgeRoot;

export const REVIEWED_WORKFLOWS = [
  ".github/workflows/bridge.yml",
  ".github/workflows/bridge-deploy.yml",
];

export function classifyLockfileMode(rootExists, serverExists) {
  if (rootExists !== serverExists) {
    throw new Error("Bridge lockfiles must be absent or committed as a pair; partial lockfile state is forbidden.");
  }
  return rootExists ? "committed" : "bootstrap";
}

function leadingSpaces(value) {
  return value.length - value.trimStart().length;
}

export function extractWorkflowRunCommands(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const commands = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(?:-\s+)?run:\s*(.*?)\s*$/);
    if (!match) continue;

    const indent = match[1].length;
    const value = match[2];
    if (!/^[|>][+-]?\d*$/.test(value)) {
      if (value !== "" && !value.startsWith("#")) commands.push(value);
      continue;
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const blockLine = lines[cursor];
      if (blockLine.trim() === "") continue;
      if (leadingSpaces(blockLine) <= indent) break;

      const command = blockLine.trim();
      if (!command.startsWith("#")) commands.push(command);
      index = cursor;
    }
  }

  return commands;
}

export function extractJobContent(content, jobName) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const jobsIndex = lines.findIndex(line => /^jobs:\s*$/.test(line));
  if (jobsIndex < 0) return "";

  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s{2})([A-Za-z0-9_-]+):\s*$/);
    if (!match || match[2] !== jobName) continue;

    const collected = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (/^\s{2}[A-Za-z0-9_-]+:\s*$/.test(line)) break;
      collected.push(line);
    }
    return collected.join("\n");
  }

  return "";
}

export function hasExactRunCommand(content, command) {
  return extractWorkflowRunCommands(content).includes(command);
}

export function hasExactExecutableLine(content, command) {
  return extractWorkflowRunCommands(content).includes(command);
}

const INSTALL_COMMAND = "npm ci --ignore-scripts --no-audit --no-fund";
const GENERATE_COMMAND = "npm run lockfiles:generate";
const REQUIRE_PRESENT_COMMAND = "npm run verify:committed-lockfiles -- --require-present";
const PACKAGE_SERVER_LOCKFILE_COMMAND = "cp server/package-lock.json dist-server/package-lock.json";

function verifyReleaseJob(workflow, jobName, content, { packageServerLockfile = false } = {}) {
  const job = extractJobContent(content, jobName);
  if (!job) throw new Error(`${workflow} must define the ${jobName} release job.`);
  if (!hasExactRunCommand(job, INSTALL_COMMAND)) {
    throw new Error(`${workflow} ${jobName} must install the reviewed build graph with npm ci and lifecycle scripts disabled.`);
  }
  if (hasExactRunCommand(job, GENERATE_COMMAND)) {
    throw new Error(`${workflow} ${jobName} must not regenerate lockfiles during release validation.`);
  }
  if (!hasExactRunCommand(job, REQUIRE_PRESENT_COMMAND)) {
    throw new Error(`${workflow} ${jobName} must require the committed lockfile pair before dependency installation.`);
  }
  if (packageServerLockfile && !hasExactExecutableLine(job, PACKAGE_SERVER_LOCKFILE_COMMAND)) {
    throw new Error(`${workflow} ${jobName} must package the committed signaling runtime lockfile.`);
  }
}

export function verifyWorkflowForLockfileMode(workflow, content, mode) {
  if (workflow.endsWith("bridge-deploy.yml")) {
    verifyReleaseJob(workflow, "build", content, { packageServerLockfile: true });
    return;
  }

  const lockfilesJob = extractJobContent(content, "lockfiles");
  const validateJob = extractJobContent(content, "validate");
  if (!lockfilesJob) throw new Error(`${workflow} must define the explicit lockfile handoff job.`);
  if (!hasExactRunCommand(lockfilesJob, GENERATE_COMMAND)) {
    throw new Error(`${workflow} lockfiles job must generate the registry-backed handoff pair.`);
  }
  if (hasExactRunCommand(lockfilesJob, INSTALL_COMMAND)) {
    throw new Error(`${workflow} lockfiles job must not install the dependency graph; it only publishes the reviewed handoff pair.`);
  }

  verifyReleaseJob(workflow, "validate", content);

  if (mode === "committed" && !hasExactRunCommand(validateJob, REQUIRE_PRESENT_COMMAND)) {
    throw new Error(`${workflow} committed mode must validate from the reviewed lockfile pair.`);
  }
}

function main() {
  let mode;
  try {
    mode = classifyLockfileMode(
      existsSync(resolve(bridgeRoot, "package-lock.json")),
      existsSync(resolve(bridgeRoot, "server/package-lock.json")),
    );
  } catch (error) {
    console.error(`Bridge lockfile mode verification failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let failed = false;
  for (const workflow of REVIEWED_WORKFLOWS) {
    const content = readFileSync(resolve(repoRoot, workflow), "utf8");
    try {
      verifyWorkflowForLockfileMode(workflow, content, mode);
    } catch (error) {
      failed = true;
      console.error(`Bridge lockfile mode verification failed: ${error.message}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log(`Bridge lockfile mode verification passed in ${mode} mode.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
