import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyLockfileMode, verifyWorkflowForLockfileMode } from "./verify-lockfile-mode.mjs";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = bridgeRoot;

const REQUIRED_FILES = [
  ".npmrc",
  "README.md",
  "docs/ACCESSIBILITY.md",
  "docs/ARTIFACT_INTEGRITY.md",
  "docs/BROWSER_COMPATIBILITY.md",
  "docs/DEPENDENCY_REVIEW.md",
  "docs/DEPLOYMENT.md",
  "docs/LOCKFILES.md",
  "docs/OBSERVABILITY.md",
  "docs/PLAN.md",
  "docs/PRIVACY.md",
  "docs/RELEASE_REVIEW.md",
  "docs/SECURITY_HEADERS.md",
  "docs/THREAT_MODEL.md",
  "docs/TURN.md",
  "index.html",
  "public/_headers",
  "public/sw.js",
  "package.json",
  "playwright.config.ts",
  "scripts/generate-lockfiles.mjs",
  "scripts/verify-isolation.mjs",
  "server/package.json",
  "src/service-worker-registration.ts",
  "tsconfig.server.json",
];

const REQUIRED_SCRIPTS = [
  "build",
  "build:server",
  "lockfiles:generate",
  "typecheck",
  "test",
  "test:e2e",
  "test:e2e:turn",
  "verify:isolation",
  "verify:release",
];

const REQUIRED_WORKFLOWS = [
  ".github/workflows/bridge.yml",
  ".github/workflows/bridge-deploy.yml",
];

const REQUIRED_SECURITY_HEADERS = new Map([
  [
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self'; upgrade-insecure-requests",
  ],
  ["Referrer-Policy", "no-referrer"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Resource-Policy", "same-origin"],
]);

function fail(message) {
  console.error(`Bridge release preflight failed: ${message}`);
  process.exitCode = 1;
}

function isPinnedVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function validatePackageJson() {
  const packageJson = JSON.parse(readFileSync(resolve(bridgeRoot, "package.json"), "utf8"));

  if (packageJson.private !== true) fail("package.json must remain private.");
  if (packageJson.engines?.node !== ">=22 <23") {
    fail('package.json must keep the reviewed Node release line ">=22 <23".');
  }

  for (const script of REQUIRED_SCRIPTS) {
    if (typeof packageJson.scripts?.[script] !== "string" || packageJson.scripts[script].trim() === "") {
      fail(`package.json is missing required script ${script}.`);
    }
  }

  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
      if (!isPinnedVersion(version)) {
        fail(`${section}.${name} must use an exact reviewed version, found ${JSON.stringify(version)}.`);
      }
    }
  }

  const signalingPackage = JSON.parse(readFileSync(resolve(bridgeRoot, "server/package.json"), "utf8"));
  if (signalingPackage.private !== true || signalingPackage.type !== "module") {
    fail("server/package.json must remain a private Node ESM runtime manifest.");
  }
  if (signalingPackage.engines?.node !== packageJson.engines?.node) {
    fail("server/package.json must use the same reviewed Node engine range as the Bridge package.");
  }
  if (signalingPackage.scripts?.start !== "node signaling.js") {
    fail('server/package.json must keep the production start command "node signaling.js".');
  }
  if (signalingPackage.dependencies?.ws !== packageJson.dependencies?.ws) {
    fail("server/package.json must pin the same ws runtime version as the Bridge package.");
  }
  if (Object.keys(signalingPackage.dependencies ?? {}).length !== 1) {
    fail("server/package.json must contain only the signaling runtime dependency set.");
  }
}

function parseNpmConfig() {
  const entries = new Map();
  const content = readFileSync(resolve(bridgeRoot, ".npmrc"), "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) {
      fail(`.npmrc contains an invalid setting: ${line}.`);
      continue;
    }
    entries.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return entries;
}

function validateNpmConfig() {
  const config = parseNpmConfig();
  const required = new Map([
    ["package-lock", "true"],
    ["save-exact", "true"],
    ["engine-strict", "true"],
  ]);

  for (const [name, value] of required) {
    if (config.get(name) !== value) {
      fail(`.npmrc must keep ${name}=${value}.`);
    }
  }
}

function parseHeaderStanzas(content) {
  const stanzas = new Map();
  let currentPath = null;

  for (const rawLine of content.replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.trim() === "") continue;

    if (!/^\s/.test(rawLine)) {
      currentPath = rawLine.trim();
      if (stanzas.has(currentPath)) {
        fail(`public/_headers contains duplicate stanza ${currentPath}.`);
      } else {
        stanzas.set(currentPath, new Map());
      }
      continue;
    }

    if (currentPath === null) {
      fail("public/_headers contains a header before any path stanza.");
      continue;
    }

    const line = rawLine.trim();
    const separator = line.indexOf(":");
    if (separator === -1) {
      fail(`public/_headers contains an invalid header line under ${currentPath}: ${line}.`);
      continue;
    }

    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const headers = stanzas.get(currentPath);
    if (headers.has(name)) {
      fail(`public/_headers contains duplicate ${name} under ${currentPath}.`);
    } else {
      headers.set(name, value);
    }
  }

  return stanzas;
}

function requireHeader(stanzas, path, name, expectedValue) {
  const headers = stanzas.get(path);
  if (!headers) {
    fail(`public/_headers is missing required stanza ${path}.`);
    return;
  }

  const actualValue = headers.get(name);
  if (actualValue !== expectedValue) {
    fail(
      `public/_headers must keep ${name}: ${expectedValue} under ${path}; found ${actualValue === undefined ? "missing" : JSON.stringify(actualValue)}.`,
    );
  }
}

function validateSecurityHeaders() {
  const content = readFileSync(resolve(bridgeRoot, "public/_headers"), "utf8");
  const stanzas = parseHeaderStanzas(content);

  for (const [name, value] of REQUIRED_SECURITY_HEADERS) {
    requireHeader(stanzas, "/*", name, value);
  }

  requireHeader(stanzas, "/manifest.webmanifest", "Cache-Control", "public, max-age=3600");
  requireHeader(stanzas, "/sw.js", "Cache-Control", "no-cache, no-store, must-revalidate");

  const index = readFileSync(resolve(bridgeRoot, "index.html"), "utf8");
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(index)) {
    fail("index.html must not contain inline scripts under the production script-src 'self' CSP.");
  }
  if (!index.includes('src="/src/service-worker-registration.ts"')) {
    fail("index.html must load the external CSP-safe service-worker registration module.");
  }
}

export function extractWorkflowActionReferences(content) {
  return [...content.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
}

export function isImmutableGitHubActionReference(reference) {
  const separator = reference.lastIndexOf("@");
  if (separator <= 0) return false;

  const action = reference.slice(0, separator);
  const revision = reference.slice(separator + 1);
  // GitHub Action references are bare `owner/repo[/path]` slugs. Excluding
  // "://" also rejects docker://<image> steps, which use the same
  // `uses: <ref>@<tag>` syntax but reference a container image rather than
  // a GitHub Action and are never immutably pinnable this way.
  return (
    action.includes("/") &&
    !action.startsWith("./") &&
    !action.includes("://") &&
    /^[0-9a-f]{40}$/i.test(revision)
  );
}

function validateWorkflowActionPins(workflow, content) {
  const references = extractWorkflowActionReferences(content);
  if (references.length === 0) {
    fail(`${workflow} must contain at least one explicitly reviewed GitHub Action reference.`);
    return;
  }

  for (const reference of references) {
    if (!isImmutableGitHubActionReference(reference)) {
      fail(`${workflow} must pin GitHub Action reference ${reference} to an immutable 40-character commit SHA.`);
    }
  }
}

function validateWorkflowRuntimePolicy(workflow, content) {
  if (!/^permissions:\s*\n\s+contents:\s+read\s*$/m.test(content)) {
    fail(`${workflow} must keep top-level GitHub token permissions read-only.`);
  }

  const timeoutMatches = [...content.matchAll(/^\s+timeout-minutes:\s*(\d+)\s*$/gm)];
  if (timeoutMatches.length === 0) {
    fail(`${workflow} must bound each Bridge job with timeout-minutes.`);
  }
  for (const [, timeoutText] of timeoutMatches) {
    const timeout = Number(timeoutText);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60) {
      fail(`${workflow} timeout-minutes must stay between 1 and 60, found ${timeoutText}.`);
    }
  }

  const checkoutCount = [...content.matchAll(/^\s*- uses:\s*actions\/checkout@/gm)].length;
  const disabledCredentialPersistenceCount = [...content.matchAll(/^\s+persist-credentials:\s*false\s*$/gm)].length;
  if (checkoutCount === 0) {
    fail(`${workflow} must check out the repository before running Bridge guards.`);
  } else if (disabledCredentialPersistenceCount < checkoutCount) {
    fail(`${workflow} must set persist-credentials: false for every actions/checkout step.`);
  }
}

function validateCiCoverage(workflow, content) {
  for (const command of ["npm run typecheck", "npm test", "npm run build", "npm run build:server", "npm run test:e2e", "npm run test:e2e:turn"]) {
    if (!content.includes(command)) {
      fail(`${workflow} must execute ${command}.`);
    }
  }
  if (!content.includes("npm ci --ignore-scripts --no-audit --no-fund")) {
    fail(`${workflow} must validate the reviewed dependency graph with npm ci while lifecycle scripts are disabled.`);
  }
}

function validateDeployArtifactIntegrity(workflow, content) {
  if (!content.includes("npm ci --ignore-scripts --no-audit --no-fund")) {
    fail(`${workflow} must install the build dependency graph with npm ci while dependency lifecycle scripts are disabled.`);
  }
  if (/\bnpm install\b/.test(content)) {
    fail(`${workflow} must not resolve the release build graph with npm install.`);
  }
  if (!content.includes("npm run build:server")) {
    fail(`${workflow} must compile the production signaling runtime.`);
  }
  if (!content.includes("cp server/package.json dist-server/package.json")) {
    fail(`${workflow} must package the signaling runtime manifest beside the compiled server.`);
  }
  if (!content.includes("cp server/package-lock.json dist-server/package-lock.json")) {
    fail(`${workflow} must package the signaling runtime lockfile beside the compiled server.`);
  }
  if (!content.includes("npm ci --omit=dev --ignore-scripts --no-audit --no-fund")) {
    fail(`${workflow} must verify the packaged signaling runtime through a production-only npm ci install.`);
  }
  if (!content.includes("npm ls --omit=dev --depth=0")) {
    fail(`${workflow} must verify the packaged signaling runtime dependency tree before upload.`);
  }
  if (!content.includes("rm -rf node_modules")) {
    fail(`${workflow} must remove validation node_modules before creating the release artifact.`);
  }
  if (!content.includes("find dist dist-server -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum > bridge-artifacts.sha256")) {
    fail(`${workflow} must generate a deterministic SHA-256 manifest for frontend and signaling artifacts.`);
  }
  if (!content.includes("sha256sum --check bridge-artifacts.sha256")) {
    fail(`${workflow} must verify the generated release artifact SHA-256 manifest before upload.`);
  }
  for (const requiredPath of ["dist", "dist-server", "bridge-artifacts.sha256"]) {
    if (!content.includes(requiredPath)) {
      fail(`${workflow} must upload ${requiredPath} in the isolated Bridge release artifact.`);
    }
  }
}

function validateWorkflows(lockfileMode) {
  for (const workflow of REQUIRED_WORKFLOWS) {
    const path = resolve(repoRoot, workflow);
    if (!existsSync(path)) {
      fail(`required Bridge workflow is missing: ${workflow}.`);
      continue;
    }

    const content = readFileSync(path, "utf8");
    if (!content.includes("scripts/verify-isolation.mjs")) {
      fail(`${workflow} must run the Bridge isolation guard.`);
    }
    if (!content.includes("scripts/release-preflight.mjs")) {
      fail(`${workflow} must run the Bridge release preflight.`);
    }
    try {
      verifyWorkflowForLockfileMode(workflow, content, lockfileMode);
    } catch (error) {
      fail(error.message);
    }
    validateWorkflowActionPins(workflow, content);
    validateWorkflowRuntimePolicy(workflow, content);
    if (workflow.endsWith("bridge.yml")) {
      validateCiCoverage(workflow, content);
    }
    if (workflow.endsWith("bridge-deploy.yml")) {
      validateDeployArtifactIntegrity(workflow, content);
    }
  }
}

function main() {
  const missing = REQUIRED_FILES.filter((path) => !existsSync(resolve(bridgeRoot, path)));
  for (const path of missing) fail(`required release artifact is missing: ${path}.`);

  let lockfileMode;
  try {
    lockfileMode = classifyLockfileMode(
      existsSync(resolve(bridgeRoot, "package-lock.json")),
      existsSync(resolve(bridgeRoot, "server/package-lock.json")),
    );
  } catch (error) {
    fail(error.message);
  }

  if (missing.length === 0) {
    validatePackageJson();
    validateNpmConfig();
    validateSecurityHeaders();
  }
  if (lockfileMode) validateWorkflows(lockfileMode);

  if (!process.exitCode) {
    console.log(`Bridge release preflight passed in ${lockfileMode} lockfile mode: required release artifacts, npm/package policy, lifecycle-script-free dependency installation, production signaling runtime lock packaging/install verification, CSP-safe service-worker registration, exact security-header/cache baseline, workflow guards, immutable action pins, read-only token permissions, checkout credential isolation, bounded job timeouts, frontend/signaling CI coverage, and release artifact integrity checks are present.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
