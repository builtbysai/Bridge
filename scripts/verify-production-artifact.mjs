import fs from "node:fs";
import path from "node:path";
import { verifyProductionFrontendArtifactConfig } from "./verify-production-deployment-config.mjs";

try {
  const headersPath = path.resolve(process.cwd(), "dist/_headers");
  if (!fs.existsSync(headersPath)) {
    throw new Error("dist/_headers is missing; run the frontend build and production header generation first");
  }
  const result = verifyProductionFrontendArtifactConfig({
    env: process.env,
    headersText: fs.readFileSync(headersPath, "utf8"),
  });
  console.log(`Production frontend artifact is deployment-consistent (${result.frontendOrigin} -> ${result.signalingOrigin}).`);
} catch (error) {
  console.error(`Production frontend artifact check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
