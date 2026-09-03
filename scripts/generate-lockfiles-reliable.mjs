import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandWithRetries } from "./command-retry.mjs";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatorPath = resolve(bridgeRoot, "scripts/generate-lockfiles.mjs");

const result = runCommandWithRetries({
  label: "Bridge lockfile generation",
  maxAttempts: 3,
  delaysMs: [1000, 3000],
  run: () => spawnSync(process.execPath, [generatorPath], {
    cwd: bridgeRoot,
    env: process.env,
    stdio: "inherit",
  }),
  onRetry: ({ nextAttempt, maxAttempts, delayMs }) => {
    console.warn(`Lockfile generation attempt failed; retrying ${nextAttempt}/${maxAttempts} after ${delayMs}ms.`);
  },
});

if (result?.error) {
  console.error(`Unable to start Bridge lockfile generator: ${result.error.message}`);
  process.exitCode = 1;
} else if (result?.status !== 0) {
  console.error(`Bridge lockfile generation failed after 3 attempts (last exit status ${result?.status ?? "unknown"}).`);
  process.exitCode = 1;
}
