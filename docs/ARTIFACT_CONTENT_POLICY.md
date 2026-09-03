# Bridge release artifact content policy

Bridge's deploy workflow builds an artifact for an operator to publish later. Before upload, `npm run verify:artifact-contents` checks the staged frontend/runtime trees so the release bundle cannot quietly grow into a source archive or secret-bearing package.

## Required release contents

The policy requires the static frontend entry point, PWA manifest, service worker, security-header file, compiled signaling entry point, minimal signaling `package.json` and lockfile, build/runtime CycloneDX SBOMs, and the SHA-256 artifact manifest.

The signaling runtime package must remain `private`, may declare no `devDependencies`, and may expose only the reviewed `start` command (`node signaling.js`). Compiled signaling modules must be JavaScript plus the reviewed package/lock/SBOM metadata.

## Rejected content

The artifact fails closed if either deploy tree contains symlinks, `node_modules`, TypeScript source, source maps, test/spec files, repository-only directories (`src`, `scripts`, `e2e`, `docs`, `.git`, `.github`), environment files, npm configuration, or common private-key/container extensions such as `.pem`, `.key`, `.p12`, and `.pfx`.

This is intentionally stricter than the SHA-256 manifest. The checksum proves that an uploaded file did not change after packaging; the content policy constrains what is allowed to be packaged in the first place.

## Workflow order

Bridge Deploy performs the relevant release steps in this order:

1. repository/supply-chain preflight;
2. dependency installation, audit, tests, and builds;
3. production-only signaling dependency installation/audit/SBOM generation, followed by removal of `node_modules`;
4. SHA-256 manifest generation and verification;
5. release artifact content-policy verification;
6. artifact upload with bounded retention.

The workflow remains artifact-only. This policy does not add hosting credentials, TURN secrets, or a production deployment target.

## Verification

Focused dependency-free `node:test` coverage creates temporary artifact trees and verifies the accepted baseline plus rejection of source maps, environment files, tests, `node_modules`, symlinks, and unreviewed runtime scripts. The checks are included in `npm run test:lockfile-policy`, so they run before registry-backed lockfile generation in Bridge Deploy.
