# Bridge artifact retention policy

Bridge workflow artifacts are intentionally short-lived. They are release/review handoff material rather than durable production storage.

## Policy

- Bridge CI dependency SBOM and generated-lockfile review artifacts use `retention-days: 7`.
- Bridge Deploy release artifacts use `retention-days: 14`.
- Every `actions/upload-artifact` step in the reviewed Bridge workflows must declare an explicit positive integer retention period within the applicable bound.
- Missing, malformed, zero, or excessive retention fails `npm run verify:artifact-retention` before dependency installation or release resolution.

The shorter CI window limits unnecessary persistence of dependency inventories and temporary lockfile review material. The deploy artifact receives a slightly longer window so an operator has time to verify checksums, promote the artifact, or perform rollback/review work without treating GitHub Actions artifacts as a long-term release repository.

## Release review

Before release, confirm:

1. `.github/workflows/bridge.yml` keeps every review artifact at seven days or less.
2. `.github/workflows/bridge-deploy.yml` keeps every deployable artifact at fourteen days or less.
3. `npm run verify:artifact-retention` passes.
4. Durable production releases are stored by the selected deployment/release system according to its own retention and rollback policy; do not extend GitHub Actions artifact retention as a substitute.
