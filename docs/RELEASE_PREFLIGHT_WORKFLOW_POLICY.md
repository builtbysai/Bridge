# Release preflight workflow policy

Bridge's dependency-free release preflight validates the two Bridge-specific GitHub workflows before any dependency-backed release work is trusted.

## Enforced invariants

- Normal step syntax (`- uses: owner/action@revision`), mapping syntax (`uses: ...`), and reusable-workflow `uses:` entries are all discovered.
- At least one explicitly reviewed external action reference must be present in each Bridge workflow.
- Every discovered external action reference must be pinned to a full 40-character Git commit SHA. Mutable tags/branches and local or Docker references do not satisfy this external-action pin policy.
- Build-graph `npm ci` validation requires `--ignore-scripts --no-audit --no-fund`, matching the lifecycle-script-free install policy enforced by the supply-chain verifier.
- The packaged signaling runtime separately requires `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` before artifact checksums are created.

## Regression coverage

`npm run test:lockfile-policy` includes `scripts/release-preflight-workflow-policy.test.mjs`, which exercises normal list-item action syntax, reusable-workflow syntax, immutable SHA acceptance, mutable tag/branch rejection, and the no-action-bypass case represented by realistic workflow text.

## Release checklist

- [x] Release preflight sees ordinary `- uses:` workflow steps instead of silently matching zero actions.
- [x] Release preflight fails closed when a Bridge workflow contains no reviewed external action references.
- [x] Release preflight's build install contract matches the lifecycle-script-free `npm ci` commands used by CI and deploy.
- [x] Focused dependency-free regression coverage is part of the lockfile/supply-chain policy test command.
- [ ] Before release, run `npm run verify:release` and `npm run test:lockfile-policy` from the checked-out release head in a normal Node 22 environment.
