import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(bridgeRoot, "..");

const CI_WORKFLOW = ".github/workflows/bridge.yml";
const DEPLOY_WORKFLOW = ".github/workflows/bridge-deploy.yml";
const LOCKFILE_GENERATOR = "bridge/scripts/generate-lockfiles.mjs";
const LOCKFILE_WORKSPACE = "bridge/scripts/lockfile-workspace.mjs";
const LOCKFILE_PUBLICATION = "bridge/scripts/lockfile-publication.mjs";
const NPM_ENVIRONMENT = "bridge/scripts/npm-environment.mjs";

const readRepoFile = (path) => readFileSync(resolve(repoRoot, path), "utf8");

function fail(message) {
  console.error(`Bridge supply-chain workflow policy failed: ${message}`);
  process.exitCode = 1;
}

function requireText(file, content, text, description) {
  if (!content.includes(text)) fail(`${file} must ${description}; missing ${JSON.stringify(text)}.`);
}

function forbidText(file, content, text, description) {
  if (content.includes(text)) fail(`${file} must ${description}; forbidden ${JSON.stringify(text)}.`);
}

function requireOrder(file, content, orderedTexts, description) {
  let previousIndex = -1;
  for (const text of orderedTexts) {
    const index = content.indexOf(text);
    if (index === -1) {
      fail(`${file} cannot verify ${description}; missing ${JSON.stringify(text)}.`);
      return;
    }
    if (index <= previousIndex) {
      fail(`${file} must keep ${description}; ${JSON.stringify(text)} appears out of order.`);
      return;
    }
    previousIndex = index;
  }
}

function extractJob(content, jobName) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const jobs = lines.findIndex(line => line === "jobs:");
  if (jobs < 0) return "";
  for (let i = jobs + 1; i < lines.length; i += 1) {
    if (lines[i] !== `  ${jobName}:`) continue;
    const block = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[j])) break;
      block.push(lines[j]);
    }
    return block.join("\n");
  }
  return "";
}

export function extractWorkflowActionReferences(content) {
  return [...content.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
}

export function isImmutableGitHubActionReference(reference) {
  const separator = reference.lastIndexOf("@");
  if (separator <= 0) return false;
  const action = reference.slice(0, separator);
  const revision = reference.slice(separator + 1);
  return action.includes("/") && !action.startsWith("./") && /^[0-9a-f]{40}$/i.test(revision);
}

export function findNpmCiWithoutIgnoreScripts(content) {
  return content.split(/\r?\n/).map(line => line.trim()).filter(line => /\bnpm ci\b/.test(line) && !/(?:^|\s)--ignore-scripts(?:\s|$)/.test(line));
}

export function findNpxWithoutNoInstall(content) {
  return content.split(/\r?\n/).map(line => line.trim()).filter(line => /\bnpx\b/.test(line) && !/(?:^|\s)--no-install(?:\s|$)/.test(line));
}

function validateActionPins(workflow, content) {
  const references = extractWorkflowActionReferences(content);
  if (references.length === 0) return fail(`${workflow} must contain at least one explicitly reviewed GitHub Action reference.`);
  for (const reference of references) {
    if (!isImmutableGitHubActionReference(reference)) fail(`${workflow} must pin GitHub Action reference ${reference} to an immutable 40-character commit SHA.`);
  }
}

function validateGenerator(content) {
  requireText(LOCKFILE_GENERATOR, content, 'const PUBLIC_REGISTRY = "https://registry.npmjs.org/"', "pin lockfile resolution to the reviewed public npm registry");
  requireText(LOCKFILE_GENERATOR, content, "withIsolatedLockfileWorkspace({ bridgeRoot, runtimeRoot }", "generate both lockfiles inside the reviewed isolated staging helper");
  requireText(LOCKFILE_GENERATOR, content, "validateLockfile(stagedBridgeRoot", "validate the staged build dependency graph before publication");
  requireText(LOCKFILE_GENERATOR, content, "validateLockfile(stagedRuntimeRoot", "validate the staged runtime dependency graph before publication");
  requireText(LOCKFILE_GENERATOR, content, "publishLockfilePair([", "publish the validated lockfiles only as a paired operation");
  requireText(LOCKFILE_GENERATOR, content, "sanitizeNpmEnvironment(process.env)", "strip ambient npm configuration and authentication variables before spawning npm");
  requireText(LOCKFILE_GENERATOR, content, "--userconfig=", "prevent ambient npm user configuration from influencing resolution");
  requireText(LOCKFILE_GENERATOR, content, "--registry=", "pass the reviewed public registry explicitly to npm");
}

function validateWorkspace(content) {
  requireText(LOCKFILE_WORKSPACE, content, "mkdtempSync", "create an isolated staging workspace");
  requireText(LOCKFILE_WORKSPACE, content, "always-auth=false", "disable automatic registry authentication");
  requireText(LOCKFILE_WORKSPACE, content, "rmSync(directory, { recursive: true, force: true })", "remove temporary dependency-generation state");
}

function validatePublication(content) {
  requireText(LOCKFILE_PUBLICATION, content, "expectedSha256", "bind publication to policy-validated staged bytes");
  requireText(LOCKFILE_PUBLICATION, content, "readRegularFileNoFollow", "avoid symlink-following during publication verification");
  requireText(LOCKFILE_PUBLICATION, content, "writeExclusive", "prepare publication files exclusively");
  requireText(LOCKFILE_PUBLICATION, content, "AggregateError", "surface incomplete rollback");
}

function validateNpmEnvironment(content) {
  requireText(NPM_ENVIRONMENT, content, "/^npm_config_/i", "strip npm configuration variables case-insensitively");
  requireText(NPM_ENVIRONMENT, content, '"NODE_AUTH_TOKEN"', "strip NODE_AUTH_TOKEN from generation");
  requireText(NPM_ENVIRONMENT, content, '"NPM_TOKEN"', "strip NPM_TOKEN from generation");
  requireText(NPM_ENVIRONMENT, content, '"NPM_AUTH_TOKEN"', "strip NPM_AUTH_TOKEN from generation");
}

function validateCommon(workflow, content) {
  validateActionPins(workflow, content);
  requireText(workflow, content, "npm run test:lockfile-policy", "run the dependency-free lockfile provenance policy");
  requireText(workflow, content, "npm ci --ignore-scripts --no-audit --no-fund", "install the reviewed build graph with npm ci while suppressing dependency lifecycle scripts");
  requireText(workflow, content, "npm audit --audit-level=high", "fail on high or critical advisories in the build graph");
  requireText(workflow, content, "npm sbom --sbom-format cyclonedx", "produce a CycloneDX build dependency inventory");
  if (/\bnpm install\b/.test(content)) fail(`${workflow} must not resolve the release/validation dependency graph with npm install.`);
  for (const command of findNpmCiWithoutIgnoreScripts(content)) fail(`${workflow} must not execute dependency lifecycle scripts during npm ci; unsafe command: ${JSON.stringify(command)}.`);
  for (const command of findNpxWithoutNoInstall(content)) fail(`${workflow} must not allow npx to download a missing executable outside the reviewed lockfile; unsafe command: ${JSON.stringify(command)}.`);
}

function validateCi(content) {
  validateCommon(CI_WORKFLOW, content);
  const lockfiles = extractJob(content, "lockfiles");
  const validate = extractJob(content, "validate");
  requireText(CI_WORKFLOW, lockfiles, "npm run lockfiles:generate", "keep registry resolution isolated to the explicit lockfile handoff job");
  forbidText(CI_WORKFLOW, validate, "npm run lockfiles:generate", "never re-resolve dependencies in the normal validation job");
  requireText(CI_WORKFLOW, validate, "npm run verify:committed-lockfiles -- --require-present", "require the reviewed committed lockfile pair before validation");
  requireText(CI_WORKFLOW, content, "name: bridge-generated-lockfile-pair", "publish generated lockfiles only from the explicit handoff path");
  requireText(CI_WORKFLOW, content, "name: bridge-dependency-sbom", "upload the build dependency SBOM for review");
  requireText(CI_WORKFLOW, content, "npx --no-install playwright install --with-deps chromium firefox webkit", "install browser binaries only through the reviewed Playwright executable");
  requireOrder(CI_WORKFLOW, validate, [
    "npm run verify:committed-lockfiles -- --require-present",
    "npm run test:lockfile-policy",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm audit --audit-level=high",
    "npm sbom --sbom-format cyclonedx",
    "npm run typecheck",
    "npm test",
    "npm run build",
    "npm run build:server",
    "npm run test:e2e",
    "npm run test:e2e:turn",
    "npm run verify:committed-lockfiles -- --require-present",
  ], "committed-lockfile gate, dependency review, test/build/browser/TURN validation, and post-validation lockfile recheck order");
}

function validateDeploy(content) {
  validateCommon(DEPLOY_WORKFLOW, content);
  const build = extractJob(content, "build");
  forbidText(DEPLOY_WORKFLOW, build, "npm run lockfiles:generate", "never re-resolve dependencies while producing a release artifact");
  requireText(DEPLOY_WORKFLOW, build, "npm run verify:committed-lockfiles -- --require-present", "require committed lockfiles before dependency installation");
  requireText(DEPLOY_WORKFLOW, content, "npm run typecheck", "typecheck before building release artifacts");
  requireText(DEPLOY_WORKFLOW, content, "npm test", "run unit and signaling integration tests before release build");
  requireText(DEPLOY_WORKFLOW, content, "cp server/package-lock.json dist-server/package-lock.json", "package the committed signaling runtime lockfile");
  requireText(DEPLOY_WORKFLOW, content, "npm ci --omit=dev --ignore-scripts --no-audit --no-fund", "verify the packaged signaling runtime with a production-only clean install");
  requireText(DEPLOY_WORKFLOW, content, "npm audit --omit=dev --audit-level=high", "fail on high or critical runtime advisories");
  requireText(DEPLOY_WORKFLOW, content, "npm sbom --omit=dev --sbom-format cyclonedx > bridge-runtime.cdx.json", "emit a production runtime CycloneDX inventory");
  requireText(DEPLOY_WORKFLOW, content, "sha256sum --check bridge-artifacts.sha256", "verify the release integrity manifest before upload");
  requireOrder(DEPLOY_WORKFLOW, build, [
    "npm run test:lockfile-policy",
    "npm run verify:committed-lockfiles -- --require-present",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm audit --audit-level=high",
    "npm sbom --sbom-format cyclonedx",
    "npm run typecheck",
    "npm test",
    "npm run build:production",
    "npm run build:server",
    "cp server/package-lock.json dist-server/package-lock.json",
    "npm ci --omit=dev --ignore-scripts --no-audit --no-fund",
    "npm audit --omit=dev --audit-level=high",
    "npm sbom --omit=dev --sbom-format cyclonedx > bridge-runtime.cdx.json",
    "sha256sum --check bridge-artifacts.sha256",
    "name: bridge-release",
  ], "committed-lockfile gate, dependency review, test/build, runtime verification, integrity verification, and artifact upload order");
}

function main() {
  validateGenerator(readRepoFile(LOCKFILE_GENERATOR));
  validateWorkspace(readRepoFile(LOCKFILE_WORKSPACE));
  validatePublication(readRepoFile(LOCKFILE_PUBLICATION));
  validateNpmEnvironment(readRepoFile(NPM_ENVIRONMENT));
  validateCi(readRepoFile(CI_WORKFLOW));
  validateDeploy(readRepoFile(DEPLOY_WORKFLOW));
  if (!process.exitCode) console.log("Bridge supply-chain workflow policy passed: registry resolution is isolated to the explicit lockfile handoff job; normal validation and release artifact creation require the committed policy-validated lockfile pair, lifecycle scripts remain disabled during clean installs, browser tooling remains lockfile-bound, advisory/SBOM/runtime/integrity gates remain enforced, and immutable workflow/action boundaries are preserved.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
