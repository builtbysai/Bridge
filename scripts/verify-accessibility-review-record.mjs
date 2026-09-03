import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const recordPath = resolve(bridgeRoot, "docs/ACCESSIBILITY_REVIEW_RECORD.md");

const REQUIRED_FIELDS = [
  "Reviewer",
  "Review date",
  "Primary OS/browser",
  "Assistive technology",
  "Secondary OS/browser",
];

export const REQUIRED_WALKTHROUGH_IDS = [
  "A11Y-01",
  "A11Y-02",
  "A11Y-03",
  "A11Y-04",
  "A11Y-05",
  "A11Y-06",
  "A11Y-07",
  "A11Y-08",
];

export function parseReviewStatus(content) {
  const match = content.match(/^Review status:\s*\*\*(PENDING|COMPLETE)\*\*\s*$/m);
  if (!match) throw new Error("accessibility review record must declare Review status as PENDING or COMPLETE");
  return match[1];
}

function parseRequiredWalkthroughs(content) {
  const requiredSection = content.match(/## Required walkthroughs\n([\s\S]*?)(?=\n## |$)/);
  if (!requiredSection) throw new Error("accessibility review record is missing the Required walkthroughs section");

  const walkthroughs = new Map();
  for (const match of requiredSection[1].matchAll(/^- \[([ x])\] \[(A11Y-\d{2})\] .+$/gm)) {
    const [, state, id] = match;
    if (walkthroughs.has(id)) {
      throw new Error(`accessibility review record contains duplicate required walkthrough id: ${id}`);
    }
    walkthroughs.set(id, state === "x");
  }

  for (const id of REQUIRED_WALKTHROUGH_IDS) {
    if (!walkthroughs.has(id)) {
      throw new Error(`accessibility review record is missing required walkthrough: ${id}`);
    }
  }

  return walkthroughs;
}

export function verifyAccessibilityReviewRecord(content, { requireComplete = false } = {}) {
  const status = parseReviewStatus(content);

  for (const field of REQUIRED_FIELDS) {
    if (!new RegExp(`^- ${field}:\\s+.+$`, "m").test(content)) {
      throw new Error(`accessibility review record is missing required field: ${field}`);
    }
  }

  const walkthroughs = parseRequiredWalkthroughs(content);

  if (status === "COMPLETE") {
    const incomplete = REQUIRED_WALKTHROUGH_IDS.filter((id) => walkthroughs.get(id) !== true);
    if (incomplete.length > 0) {
      throw new Error(`completed accessibility review still has ${incomplete.length} unchecked required walkthrough item(s): ${incomplete.join(", ")}`);
    }

    const placeholderPattern = /:\s*(TBD|PENDING|NOT RUN|<[^>]+>)\s*$/im;
    if (placeholderPattern.test(content)) {
      throw new Error("completed accessibility review still contains placeholder metadata");
    }

    if (!/^## Findings\n[\s\S]*?^- Result:\s*(PASS|PASS WITH FOLLOW-UP)\s*$/m.test(content)) {
      throw new Error("completed accessibility review must record a PASS or PASS WITH FOLLOW-UP result");
    }
  }

  if (requireComplete && status !== "COMPLETE") {
    throw new Error("accessibility review is still pending");
  }

  return status;
}

function main() {
  const requireComplete = process.argv.includes("--require-complete");
  const content = readFileSync(recordPath, "utf8");
  try {
    const status = verifyAccessibilityReviewRecord(content, { requireComplete });
    console.log(`Bridge accessibility review record is structurally valid (${status.toLowerCase()}).`);
  } catch (error) {
    console.error(`Bridge accessibility review verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
