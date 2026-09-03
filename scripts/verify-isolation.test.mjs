import { describe, expect, it } from "vitest";
import { findIsolationViolations, isBridgeOwnedPath } from "./verify-isolation.mjs";

// This repository used to live at `bridge/` inside a monorepo alongside sibling
// projects. Now that Bridge has been extracted into its own repository, every
// path in a diff is Bridge-owned by definition, so the check is a no-op that
// always allows every path. See the comment in verify-isolation.mjs.
describe("Bridge path isolation", () => {
  it("allows any repository path now that Bridge is a standalone repository", () => {
    expect(isBridgeOwnedPath("src/main.ts")).toBe(true);
    expect(isBridgeOwnedPath("docs/PLAN.md")).toBe(true);
    expect(isBridgeOwnedPath(".github/workflows/bridge.yml")).toBe(true);
    expect(isBridgeOwnedPath(".github/workflows/bridge-deploy.yml")).toBe(true);
    expect(isBridgeOwnedPath("README.md")).toBe(true);
  });

  it("never reports isolation violations", () => {
    expect(findIsolationViolations([
      "src/main.ts",
      "README.md",
      "server/signaling.ts",
    ])).toEqual([]);
  });
});
