import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function fail(message) {
  console.error(`Bridge production-origin policy failed: ${message}`);
  process.exitCode = 1;
}

const config = readFileSync(resolve(bridgeRoot, "server/config.ts"), "utf8");
const readme = readFileSync(resolve(bridgeRoot, "README.md"), "utf8");

const requiredConfigSnippets = [
  'if (env.NODE_ENV === "production")',
  'if (allowedOrigins.length === 0)',
  'SIGNAL_ALLOWED_ORIGINS is required when NODE_ENV=production.',
  'allowedOrigins.some((origin) => !origin.startsWith("https://"))',
  'SIGNAL_ALLOWED_ORIGINS must contain only HTTPS origins when NODE_ENV=production.',
  'allowedOrigins.some((origin) => isLoopbackHostname(new URL(origin).hostname))',
  'SIGNAL_ALLOWED_ORIGINS must not contain loopback origins when NODE_ENV=production.',
];

for (const snippet of requiredConfigSnippets) {
  if (!config.includes(snippet)) {
    fail(`server/config.ts no longer enforces the reviewed production Origin invariant: ${snippet}`);
  }
}

if (!readme.includes("`SIGNAL_ALLOWED_ORIGINS` is mandatory")) {
  fail("README.md must document the mandatory production signaling Origin allowlist.");
}
if (!readme.includes("every configured browser origin must use HTTPS")) {
  fail("README.md must document the HTTPS-only production signaling Origin requirement.");
}
if (!readme.includes("loopback origins are rejected")) {
  fail("README.md must document the non-loopback production signaling Origin requirement.");
}

if (!process.exitCode) {
  console.log(
    "Bridge production-origin policy passed: production signaling requires a non-empty, HTTPS, non-loopback Origin allowlist and the operator contract is documented.",
  );
}
