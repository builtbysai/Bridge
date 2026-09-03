# Release artifact validation gate

Bridge's manual `Bridge Deploy` workflow is an artifact-production path, not a production deployment target. Until real hosting, signaling, and TURN infrastructure are selected, it must fail before creating or uploading `bridge-release` when the resolved repository graph does not pass the core repository-side checks.

## Required ordering

After the isolated/public-registry lockfile graph is generated and installed with `npm ci`, the artifact workflow must complete all of the following before building or packaging release output:

1. fail on high-severity dependency advisories;
2. generate the build dependency SBOM;
3. run `npm run typecheck`;
4. run `npm test`, including signaling integration coverage;
5. build the static frontend and production signaling runtime;
6. perform a clean production-only install of the packaged signaling runtime, validate its declared runtime tree, audit it, and emit its runtime SBOM;
7. generate and verify the release SHA-256 manifest before artifact upload.

Browser Playwright and local-coturn validation remain in the manual Bridge CI workflow because that path provisions browser engines and a disposable TURN server. They are still release requirements and are not replaced by the artifact workflow's typecheck/unit gate.

## Policy enforcement

`bridge/scripts/verify-supply-chain-workflows.mjs` requires the deploy workflow to retain both `npm run typecheck` and `npm test` in addition to the existing lockfile, audit, SBOM, runtime-install, and artifact-integrity controls. This prevents a later workflow edit from silently returning to a build-only release artifact path.

## External configuration boundary

This gate does not require or invent production credentials. Real hosting configuration, the deployed frontend/signaling origins, TURN endpoints and credentials, operator monitoring configuration, and the production smoke test remain external release inputs.
