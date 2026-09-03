# Lockfile generation failure cleanup

Bridge's release lockfile bootstrap uses a temporary workspace outside the repository for both generated dependency graphs and its private npm user configuration. That workspace must be removed whether generation succeeds or fails.

## Release checklist

- [x] Lockfile generation failures throw through the workspace helper rather than calling `process.exit()` from inside the cleanup boundary.
- [x] The workspace helper owns cleanup in a `finally` block, covering successful callbacks and thrown npm/policy/publication failures.
- [x] Dependency-free `node:test` coverage verifies the temporary workspace disappears after both success and a simulated generation failure.
- [x] `test:lockfile-policy` includes the workspace cleanup regression suite.
- [x] The supply-chain workflow verifier checks the split generator/workspace/publication modules rather than stale pre-refactor source strings.
- [x] No production credentials are introduced: the temporary `.npmrc` remains credential-free and pinned to the public npm registry.

This is failure hygiene, not a substitute for the release lockfile gate. Bridge still requires both genuine registry-generated lockfiles to be reviewed and committed together before release, followed by the dependency-backed validation suite described in `RELEASE_REVIEW.md`.
