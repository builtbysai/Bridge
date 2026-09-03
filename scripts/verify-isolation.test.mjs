import { describe, expect, it } from "vitest";
import { findIsolationViolations, isBridgeOwnedPath } from "./verify-isolation.mjs";

describe("Bridge path isolation", () => {
  it("allows Bridge project files and the two Bridge workflows", () => {
    expect(isBridgeOwnedPath("bridge/src/main.ts")).toBe(true);
    expect(isBridgeOwnedPath("bridge/docs/PLAN.md")).toBe(true);
    expect(isBridgeOwnedPath(".github/workflows/bridge.yml")).toBe(true);
    expect(isBridgeOwnedPath(".github/workflows/bridge-deploy.yml")).toBe(true);
  });

  it("rejects sibling projects and unrelated repository files", () => {
    expect(findIsolationViolations([
      "bridge/src/main.ts",
      "colortrace/src/main.ts",
      "extensible-terminal/package.json",
      "README.md",
    ])).toEqual([
      "colortrace/src/main.ts",
      "extensible-terminal/package.json",
      "README.md",
    ]);
  });

  it("does not allow similarly prefixed workflow or project paths", () => {
    expect(isBridgeOwnedPath("bridge-old/src/main.ts")).toBe(false);
    expect(isBridgeOwnedPath(".github/workflows/bridge-preview.yml")).toBe(false);
  });
});
