# Bridge dependency installation policy

Bridge release and validation workflows install dependency graphs with `npm ci --ignore-scripts`.

## Why lifecycle scripts are disabled

A reviewed lockfile constrains package identity and integrity, but npm lifecycle hooks can still execute package-provided code during installation. Bridge does not require implicit dependency lifecycle hooks in CI or release artifact construction: Playwright browser installation is an explicit workflow step, and the packaged signaling runtime is already verified with a production-only `npm ci --omit=dev --ignore-scripts` install.

Suppressing lifecycle scripts therefore reduces the amount of third-party code that executes before Bridge's own typecheck, test, build, advisory, SBOM, browser, and TURN validation gates.

## Enforced workflow contract

- Build/test dependency installation uses `npm ci --ignore-scripts --no-audit --no-fund`.
- The packaged signaling runtime uses `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`.
- `bridge/scripts/verify-supply-chain-workflows.mjs` rejects any `npm ci` command in either Bridge workflow that omits `--ignore-scripts`.
- `npm install` remains forbidden for release/validation dependency resolution.
- Browser binaries and operating-system packages required by tests are installed through explicit reviewed workflow steps rather than package lifecycle hooks.

## Release checklist

- [x] Bridge CI suppresses dependency lifecycle scripts during the build/test install.
- [x] Bridge Deploy suppresses dependency lifecycle scripts during the build/test install.
- [x] The production signaling runtime install suppresses dependency lifecycle scripts.
- [x] Dependency-free regression coverage rejects `npm ci` commands that omit `--ignore-scripts`.
- [ ] After genuine registry-generated lockfiles are committed, rerun the full dependency-backed typecheck, unit/integration, build, browser, and local-TURN validation using this install policy.

If a future dependency genuinely requires an install-time script, do not silently remove `--ignore-scripts`. Document the exact package, script, reason, and reviewed execution boundary, then update the workflow policy and security review deliberately.
