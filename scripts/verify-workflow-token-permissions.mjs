import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = bridgeRoot;

export const REVIEWED_WORKFLOWS = [
  ".github/workflows/bridge.yml",
  ".github/workflows/bridge-deploy.yml",
];

export function validateWorkflowTokenPermissions(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const declarations = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^(\s*)permissions:\s*(.*)$/.exec(line);
    if (!match) continue;

    declarations.push({ index, indent: match[1].length, inlineValue: match[2].trim() });
  }

  if (declarations.length !== 1) {
    return `expected exactly one permissions declaration, found ${declarations.length}`;
  }

  const declaration = declarations[0];
  if (declaration.indent !== 0) {
    return "permissions must be declared only at workflow top level";
  }
  if (declaration.inlineValue !== "") {
    return "top-level permissions must use the reviewed mapping form";
  }

  const entries = [];
  for (let index = declaration.index + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const indent = /^\s*/.exec(line)[0].length;
    if (indent === 0) break;

    const entry = /^\s+([A-Za-z0-9_-]+):\s*([^#]*?)\s*(?:#.*)?$/.exec(line);
    if (!entry) {
      return `invalid top-level permissions entry: ${line.trim()}`;
    }
    entries.push([entry[1], entry[2].trim()]);
  }

  if (entries.length !== 1 || entries[0][0] !== "contents" || entries[0][1] !== "read") {
    return 'workflow token permissions must be exactly "contents: read"';
  }

  return null;
}

function main() {
  let failed = false;

  for (const workflow of REVIEWED_WORKFLOWS) {
    const content = readFileSync(resolve(repoRoot, workflow), "utf8");
    const error = validateWorkflowTokenPermissions(content);
    if (error) {
      failed = true;
      console.error(`Bridge workflow token-permission policy failed for ${workflow}: ${error}.`);
    }
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log(
    "Bridge workflow token-permission policy passed: reviewed workflows expose only the read-only contents permission and contain no job-level permission overrides.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
