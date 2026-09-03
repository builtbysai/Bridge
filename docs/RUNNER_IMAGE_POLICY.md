# GitHub Actions runner image policy

Bridge CI and Bridge Deploy use the explicit `ubuntu-24.04` GitHub-hosted runner label rather than the moving `ubuntu-latest` alias.

This does not make the hosted image byte-for-byte immutable: GitHub continues to patch hosted runner images. It does, however, keep Bridge on a reviewed Ubuntu release line and prevents an automatic `ubuntu-latest` major-version transition from changing the release environment without a repository review.

## Release guard

`npm run verify:runner-image` is dependency-free and runs before dependency installation in both Bridge workflows. It fails closed when a reviewed workflow has no explicit `runs-on:` value or when any explicit job uses a runner other than `ubuntu-24.04`.

The focused `scripts/verify-runner-image.test.mjs` coverage verifies the reviewed image, rejects mutable `*-latest` aliases and mixed images, and rejects workflows with no explicit runner declaration. The test is part of `npm run test:lockfile-policy`.

## Updating the runner

A future runner-image change must be deliberate: update both Bridge-specific workflows and the reviewed value in `scripts/verify-runner-image.mjs` together, run the dependency-free policy suite, then run the full dependency-backed Bridge validation on the new image before treating it as release-approved.
