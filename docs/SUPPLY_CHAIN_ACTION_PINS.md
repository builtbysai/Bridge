# GitHub Actions pinning policy

Bridge CI and Bridge Deploy treat every `uses:` reference as executable supply-chain input. External GitHub Actions must therefore be pinned to a full 40-character commit SHA; mutable tags and branches such as `@v4`, `@main`, or `@latest` are not accepted.

## Enforcement

`bridge/scripts/verify-supply-chain-workflows.mjs` scans both Bridge-specific workflow files and fails closed when:

- no action references are found, which prevents a broken parser from silently reporting success;
- a normal step-level `- uses:` reference is not recognized;
- a job/reusable-workflow `uses:` reference is not recognized;
- a reference has no revision or uses a tag/branch instead of a full commit SHA; or
- a local/Docker-style reference is introduced without an explicit policy change and review.

The dependency-free regression test `bridge/scripts/verify-supply-chain-workflows.test.mjs` specifically covers the standard YAML `- uses:` form that the earlier release-preflight regex failed to match. It also covers job-level references and rejection of mutable revisions. The test is part of `npm run test:lockfile-policy`, so the existing pre-install repository policy step exercises it before registry-backed lockfile generation.

## Release checklist

- [x] Bridge CI action references are immutable SHA pins.
- [x] Bridge Deploy action references are immutable SHA pins.
- [x] The supply-chain verifier recognizes ordinary step-level `- uses:` syntax instead of silently matching zero actions.
- [x] The verifier fails if its scan returns zero action references.
- [x] Dependency-free regression coverage rejects mutable action tags/branches.
- [ ] Re-review and deliberately update each SHA when upgrading an action; do not replace SHA pins with convenience tags.

This policy is repository-side only and does not require production hosting, TURN credentials, or other deployment secrets.
