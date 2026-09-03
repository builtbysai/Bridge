# Bridge lockfile mode policy

Bridge has two valid dependency-resolution states during release preparation. `scripts/verify-lockfile-mode.mjs` fails closed for any state between them, and `scripts/release-preflight.mjs` now consumes the same mode classification so release preflight cannot drift back to bootstrap-only behavior.

## Bootstrap mode

Bootstrap mode applies only while both `bridge/package-lock.json` and `bridge/server/package-lock.json` are absent. In this mode both reviewed Bridge workflows must generate the pair through `npm run lockfiles:generate` and then install the generated build graph with `npm ci --ignore-scripts --no-audit --no-fund`.

The lockfiles remain review artifacts rather than a release boundary until they have passed the full validation sequence, been reviewed together, and been committed together.

## Committed mode

Committed mode begins only when both lockfiles exist in the repository. In this mode the reviewed workflows must not run `npm run lockfiles:generate`; they must consume the committed dependency graph with lifecycle-script-free `npm ci`. Bridge Deploy must continue copying the committed `server/package-lock.json` beside the compiled signaling runtime so the production-only runtime install is reproducible.

A state where exactly one lockfile exists is invalid. A state where both lockfiles are committed but either reviewed workflow still regenerates them is also invalid. These checks run before registry access so an incomplete release transition fails before dependency resolution.

The workflow command checks are intentionally strict. Required generation and build-graph install commands must be exact YAML `run:` commands, and the deploy runtime-lockfile copy must be either an exact scalar `run:` command or an exact executable line in a multiline run block. Comments, `echo` wrappers, commands with appended `|| true`, and other textual mentions do not satisfy the policy. This prevents a superficially present command string from bypassing the lockfile-mode release boundary without actually executing the required operation.

## Release preflight transition behavior

The release preflight now imports the same lockfile-mode classifier and workflow-mode verifier instead of independently hard-coding temporary generation. In bootstrap mode it therefore requires generation plus lifecycle-script-free `npm ci`; in committed mode it rejects generation and requires the deploy workflow to package the committed signaling lockfile. The rest of the release checks—exact dependency pins, security headers, action pins, token/checkout restrictions, bounded jobs, CI coverage, runtime install verification, and artifact integrity—remain unchanged.

This removes a release-time two-step hazard: when the genuine reviewed lockfile pair is committed and the temporary generation steps are removed in the same change, `npm run verify:release` is already capable of validating that committed-only state. No follow-up rewrite of the release preflight is required.

## Committed-pair provenance validation

`scripts/verify-committed-lockfiles.mjs` closes the other side of the transition boundary. While both lockfiles are absent it succeeds in bootstrap mode without inventing dependency metadata. Once both files are present, it parses the actual repository lockfiles and validates them against the same reviewed policy used after registry generation: lockfile version 3, exact root manifest identity and dependency maps, exact `https://registry.npmjs.org` package origins, no credential/query/fragment-bearing tarball URLs, no linked or unresolved packages, and canonical 64-byte SHA-512 integrity metadata.

Both Bridge workflows execute this verifier before dependency resolution, and the workflow-guard coverage policy requires the step to remain wired. This means committed mode does not merely trust the presence of two files; malformed, stale-root, off-registry, or weak-integrity lockfiles fail before `npm ci` can consume them.

## Transition checklist

- [x] Reject a partial root/server lockfile pair.
- [x] Require temporary registry-backed generation while both reviewed lockfiles are absent.
- [x] Require lifecycle-script-free `npm ci` in both bootstrap and committed modes.
- [x] Reject on-the-fly lockfile generation after both lockfiles are committed.
- [x] Require Bridge Deploy to package the committed signaling runtime lockfile.
- [x] Require the lockfile-mode commands to be executable workflow commands rather than comments/wrappers.
- [x] Validate the actual committed root/server lockfiles against the reviewed registry, root-map, and canonical-integrity policy when present.
- [x] Wire both lockfile guards into both reviewed workflows before dependency resolution.
- [x] Include focused dependency-free regression coverage in `npm run test:lockfile-policy`.
- [x] Make release preflight mode-aware so the committed-pair transition does not require a separate preflight rewrite.
- [ ] Obtain both genuine registry-generated lockfiles from the same fully validated Bridge CI run and review them together.
- [ ] Commit the reviewed pair together and remove the temporary generation steps in the same transition.

This policy does not create or invent dependency integrity metadata. The transition to committed mode still requires a functioning npm registry environment and the full dependency-backed release validation described in `docs/RELEASE_REVIEW.md`.
