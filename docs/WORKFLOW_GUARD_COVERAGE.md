# Workflow guard coverage

Bridge keeps multiple dependency-free repository-side policy checks in front of registry access and dependency installation. Those checks are useful only while both reviewed Bridge workflows continue to invoke them.

`npm run verify:workflow-guards` fails closed when either `.github/workflows/bridge.yml` or `.github/workflows/bridge-deploy.yml` stops invoking one of the reviewed guard commands as an exact `run:` step. Comments, disabled shell fallbacks such as `|| true`, and similarly named commands do not satisfy the check.

The reviewed guard set currently covers Bridge-only path isolation, read-only GitHub token permissions, bounded concurrency, checkout credential isolation, runner-image pinning, per-job timeouts, artifact retention, supply-chain workflow policy, the release preflight, production signaling Origin policy, and the dependency-free lockfile-policy regression suite.

## Release checklist

- Run `npm run verify:workflow-guards` before dependency resolution.
- Keep the guard in both Bridge CI and Bridge Deploy when workflow steps are reorganized.
- When adding or replacing a repository-side security/release guard, update the reviewed command list and focused tests in the same change.
- Do not weaken the verifier to substring matching; exact `run:` matching prevents comments or `|| true` wrappers from impersonating an enforced guard.

This policy does not replace the individual verifiers. It protects their workflow wiring so an accidental deletion of a guard step is detected before registry-backed work begins.
