# Bridge workflow concurrency policy

Bridge CI and Bridge Deploy must not allow stale or overlapping runs to publish review or release artifacts concurrently.

## Reviewed configuration

- Bridge CI uses `group: bridge-ci-${{ github.ref }}` with `cancel-in-progress: true`. Runs on different refs remain independent, while a newer run on the same ref supersedes an older in-progress run.
- Bridge Deploy uses the single production artifact group `bridge-deploy-production` with `cancel-in-progress: true`. Only the latest in-progress production-artifact build is allowed to continue.

This is intentionally separate from job `timeout-minutes`: timeouts bound one run's lifetime, while concurrency prevents multiple obsolete runs from consuming resources or racing artifact publication.

## Enforcement

`npm run verify:workflow-concurrency` is dependency-free and runs before registry/dependency work in both Bridge workflows. It fails closed when:

- top-level `concurrency` is missing or duplicated;
- the workflow's concurrency group differs from the reviewed value;
- `cancel-in-progress` is missing, duplicated, malformed, or not `true`.

Focused `node:test` coverage is part of `npm run test:lockfile-policy` so the parser/policy cannot silently regress.

## Release checklist

- Keep CI concurrency scoped to `github.ref` so unrelated branches do not cancel one another.
- Keep the deploy artifact workflow in one production group until distinct production environments are deliberately introduced and reviewed.
- Keep `cancel-in-progress: true` unless release semantics are redesigned to require queued immutable releases.
- If production environments are added later, update this policy, its tests, and the verifier in the same change rather than weakening the guard ad hoc.
