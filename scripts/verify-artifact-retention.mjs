import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(bridgeRoot, "..");

export const CI_WORKFLOW = ".github/workflows/bridge.yml";
export const DEPLOY_WORKFLOW = ".github/workflows/bridge-deploy.yml";
export const CI_MAX_RETENTION_DAYS = 7;
export const DEPLOY_MAX_RETENTION_DAYS = 14;

function indentation(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

export function extractUploadArtifactRetentions(content) {
  const lines = content.split(/\r?\n/);
  const results = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*(?:-\s*)?uses:\s*actions\/upload-artifact@[^\s#]+/.test(line)) continue;

    const usesIndent = indentation(line);
    const stepIndent = /^\s*-\s*uses:/.test(line) ? usesIndent : Math.max(0, usesIndent - 2);
    let retentionDays = null;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      const trimmed = candidate.trim();
      if (!trimmed) continue;

      if (indentation(candidate) <= stepIndent && trimmed.startsWith("- ")) break;

      const match = trimmed.match(/^retention-days:\s*(\S+)\s*$/);
      if (match) {
        retentionDays = /^\d+$/.test(match[1]) ? Number(match[1]) : null;
        break;
      }
    }

    results.push(retentionDays);
  }

  return results;
}

export function findArtifactRetentionViolations(content, maxDays) {
  const retentions = extractUploadArtifactRetentions(content);
  if (retentions.length === 0) return ["no upload-artifact steps found"];

  return retentions.flatMap((days, index) => {
    if (!Number.isSafeInteger(days) || days < 1 || days > maxDays) {
      return [`upload-artifact step ${index + 1} must set retention-days to an integer between 1 and ${maxDays}`];
    }
    return [];
  });
}

function validateWorkflow(path, maxDays) {
  const content = readFileSync(resolve(repoRoot, path), "utf8");
  const violations = findArtifactRetentionViolations(content, maxDays);
  for (const violation of violations) {
    console.error(`Bridge artifact retention policy failed: ${path}: ${violation}.`);
  }
  return violations.length === 0;
}

export function main() {
  const ciValid = validateWorkflow(CI_WORKFLOW, CI_MAX_RETENTION_DAYS);
  const deployValid = validateWorkflow(DEPLOY_WORKFLOW, DEPLOY_MAX_RETENTION_DAYS);

  if (!ciValid || !deployValid) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `Bridge artifact retention policy passed: CI review artifacts are retained for at most ${CI_MAX_RETENTION_DAYS} days and deployable release artifacts for at most ${DEPLOY_MAX_RETENTION_DAYS} days.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
