import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = bridgeRoot;
const WORKFLOWS = [
  ".github/workflows/bridge.yml",
  ".github/workflows/bridge-deploy.yml",
];

function indentation(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

export function findCheckoutStepsWithoutCredentialIsolation(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const unsafe = [];

  for (let index = 0; index < lines.length; index += 1) {
    const checkout = lines[index].match(/^(\s*)-\s+uses:\s*(actions\/checkout@[^\s#]+)(?:\s+#.*)?$/);
    if (!checkout) continue;

    const stepIndent = checkout[1].length;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextStep = lines[cursor].match(/^(\s*)-\s+/);
      if (nextStep && nextStep[1].length <= stepIndent) {
        end = cursor;
        break;
      }
    }

    let withIndent = null;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (/^\s*(?:#.*)?$/.test(lines[cursor])) continue;
      const withMatch = lines[cursor].match(/^(\s*)with:\s*(?:#.*)?$/);
      if (withMatch && withMatch[1].length > stepIndent) {
        withIndent = withMatch[1].length;
        break;
      }
    }

    let isolated = false;
    if (withIndent !== null) {
      for (let cursor = index + 1; cursor < end; cursor += 1) {
        const line = lines[cursor];
        if (/^\s*(?:#.*)?$/.test(line)) continue;
        const indent = indentation(line);
        if (indent <= withIndent && !/^\s*with:\s*(?:#.*)?$/.test(line)) continue;
        const persist = line.match(/^(\s*)persist-credentials:\s*false\s*(?:#.*)?$/);
        if (persist && persist[1].length > withIndent) {
          isolated = true;
          break;
        }
      }
    }

    if (!isolated) unsafe.push(checkout[2]);
  }

  return unsafe;
}

export function validateCheckoutCredentialIsolation(content, workflow = "workflow") {
  const checkoutCount = [...content.matchAll(/^\s*-\s+uses:\s*actions\/checkout@[^\s#]+/gm)].length;
  if (checkoutCount === 0) {
    throw new Error(`${workflow} must contain at least one actions/checkout step.`);
  }

  const unsafe = findCheckoutStepsWithoutCredentialIsolation(content);
  if (unsafe.length > 0) {
    throw new Error(
      `${workflow} must set persist-credentials: false inside the with: block of every actions/checkout step; unsafe: ${unsafe.join(", ")}.`,
    );
  }
}

function main() {
  let failed = false;
  for (const workflow of WORKFLOWS) {
    try {
      validateCheckoutCredentialIsolation(readFileSync(resolve(repoRoot, workflow), "utf8"), workflow);
    } catch (error) {
      failed = true;
      console.error(`Bridge checkout credential policy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Bridge checkout credential policy passed: every checkout keeps GitHub credentials out of subsequent build/test git configuration.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
