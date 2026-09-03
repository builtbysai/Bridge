# Bridge direct dependency review

This document records the repository-side security review of Bridge's directly pinned npm packages. It is intentionally limited to direct dependencies visible in `bridge/package.json` and `bridge/server/package.json`; the transitive dependency tree must still be reviewed after registry-generated lockfiles exist.

Review date: 2026-08-30.

## Reviewed runtime dependencies

- `@noble/hashes` `2.0.0` — cryptographic hashing/HMAC primitives used by the browser application.
- `qrcode` `1.5.4` — QR rendering for the browser pairing flow. This is the `qrcode` package, not similarly named packages such as `qrcode-express`.
- `ws` `8.21.1` — signaling WebSocket runtime. The same exact version is required in the minimal `bridge/server/package.json` production runtime manifest.

## Reviewed development/build dependencies

Bridge keeps every top-level development dependency on an exact version and constrains release work to Node 22. The release preflight rejects semver ranges so dependency changes require an explicit repository review.

The Vite pin is `7.3.6`. Earlier Bridge pin `7.1.3` fell within multiple reviewed Vite file-read advisory ranges. The 7.x security fixes included:

- GHSA-p9ff-h696-f583 / CVE-2026-39363: Vite dev-server WebSocket arbitrary file read, patched in Vite `7.3.2`.
- GHSA-fx2h-pf6j-xcff / CVE-2026-53571: Windows alternate-path `server.fs.deny` bypass, patched in Vite `7.3.5`.
- Vite `7.3.6` advances the 7.x line again so its esbuild dependency can resolve beyond the vulnerable esbuild 0.27.x line identified by GHSA-g7r4-m6w7-qqqr.

These dev-server issues do not imply that Bridge's static production artifact was directly exposed, but release tooling should not retain known-vulnerable development dependencies when a compatible reviewed patch exists.

## Registry-backed audit and SBOM gates

Once the temporary registry-backed lockfiles are generated, both manual Bridge workflows perform additional supply-chain checks before treating the dependency graph as releasable:

- Bridge CI runs `npm audit --audit-level=high` after `npm ci`. Any high or critical advisory in the complete build/test graph fails the job.
- Bridge Deploy applies the same high/critical advisory gate to the complete build graph and then repeats it with `--omit=dev` inside the packaged signaling runtime after a clean production-only install.
- Bridge CI emits a CycloneDX SBOM for the installed build/test graph as the `bridge-dependency-sbom` artifact so reviewers can inspect the resolved transitive inventory alongside the generated lockfiles.
- Bridge Deploy emits a CycloneDX build dependency SBOM plus a production-only signaling runtime SBOM. The runtime SBOM is stored inside `dist-server/`; both SBOMs are covered by the release artifact SHA-256 manifest.

These checks deliberately use npm's registry-backed advisory and SBOM facilities only after the lockfile provenance policy and `npm ci` installation have succeeded. They do not replace review of unexpected packages, licenses, provenance, or integrity metadata, and they are not claimed as executed until a GitHub runner or equivalent networked Node 22 environment completes the workflows.

The workflow contract itself is now guarded by `scripts/verify-supply-chain-workflows.mjs`, a dependency-free Node policy check that runs before registry access in both Bridge CI and Bridge Deploy. It fails if either workflow drops the lockfile provenance check, registry-backed lockfile generation, `npm ci`, high/critical audit gate, CycloneDX inventory, production runtime audit/install verification, or required release-integrity coverage. This protects the repository-side release gate from silently weakening during later workflow edits; it does not claim that the registry-backed checks have executed.

## Lockfile and transitive review gate

This direct-package review does **not** substitute for reproducible lockfiles or a registry-backed audit. Before release:

1. Generate `bridge/package-lock.json` and `bridge/server/package-lock.json` from the real npm registry with `npm run lockfiles:generate` on the reviewed Node 22 line.
2. Review the generated transitive package versions, registry origins, and integrity metadata; do not synthesize or hand-author integrity values.
3. Confirm the high/critical advisory gates pass and inspect the generated CycloneDX dependency inventories for unexpected packages or dependency drift.
4. Run the full dependency-backed typecheck, unit/integration, frontend/server build, Playwright, and local-coturn checks.
5. Switch Bridge CI/deploy installation to committed-lockfile-only `npm ci` (and the packaged signaling runtime to `npm ci --omit=dev`) after those generated lockfiles are committed and reviewed.

Production hosting, TURN credentials, and operator secrets are unrelated to this dependency review and must remain outside the repository.
