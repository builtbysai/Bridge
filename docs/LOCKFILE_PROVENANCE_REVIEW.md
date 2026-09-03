# Bridge lockfile provenance review

This checklist is the focused review boundary for the registry-generated `bridge/package-lock.json` and `bridge/server/package-lock.json` pair. It supplements `LOCKFILES.md`; it does not permit hand-authored lockfiles or integrity metadata.

## Automated policy

Before either generated lockfile can be accepted, `scripts/lockfile-policy.mjs` requires:

- [x] npm lockfile version 3 and root package identity matching the reviewed manifest.
- [x] Root `dependencies` and `devDependencies` maps exactly matching the reviewed manifest.
- [x] Every non-root package resolving from the exact `https://registry.npmjs.org` origin with no credentials, nonstandard port, query string, or fragment.
- [x] Every registry URL resolving to the canonical tarball path for the package path and exact locked version; a tarball for another package, another version, or another filename fails closed even when it is hosted on `registry.npmjs.org`.
- [x] Canonical SHA-512 integrity metadata decoding to exactly 64 bytes and round-tripping to the same base64 text.
- [x] Linked, unresolved, malformed-path, and malformed registry entries failing closed.
- [x] Every uploaded lockfile handoff includes `lockfile-handoff-manifest.json`, binding the two generated lockfiles plus both source `package.json` manifests to the exact 40-character source commit/ref with SHA-256 digests and byte counts.
- [x] The handoff manifest records the exact reviewed Node `22.23.2` runtime plus npm `10.9.8`; generation, verification, and repository adoption all reject another Node 22 patch/minor release rather than treating the major line as equivalent.
- [x] The lockfile generator itself now refuses to contact the registry unless its executing runtime is exactly Node `v22.23.2` and the `npm` executable reports exactly `10.9.8`. This closes the direct/local invocation gap where workflow guards and later handoff verification were exact but `npm run lockfiles:generate` previously accepted any Node 22 runtime before producing repository lockfiles.
- [x] Bridge CI and Bridge Deploy pin `actions/setup-node` to Node `22.23.2`, whose official distribution bundles npm `10.9.8`; `bridge/package.json` also declares `packageManager: npm@10.9.8` so the intended lockfile resolver is explicit in repository metadata.
- [x] `scripts/verify-toolchain-policy.mjs` independently fails closed unless `bridge/package.json` keeps npm `10.9.8`, the reviewed Node engine range, and every runner-backed job in both Bridge workflows has exactly one `node-version: 22.23.2` pin. Both Bridge workflows now execute `npm run verify:toolchain` as an explicit repository guard before lockfile generation or dependency installation, and `scripts/verify-workflow-guard-coverage.mjs` fails if that guard is removed. Dependency-free regression coverage remains part of `test:lockfile-policy`.
- [x] `npm run lockfiles:adopt -- --artifact <dir>` verifies the downloaded artifact against the current Git commit/ref, both current source manifests, exact reviewed Node/npm generator versions, the exact manifest file set, and both lockfile digests before writing either repository lockfile. It refuses to overwrite an existing repository lockfile and rolls back newly written destinations if pair publication fails.

The canonical tarball check covers unscoped and scoped packages. For example, `node_modules/ws` version `8.21.1` must resolve to `/ws/-/ws-8.21.1.tgz`, while `node_modules/@scope/tool` version `1.2.3` must resolve to `/@scope/tool/-/tool-1.2.3.tgz`. This closes a provenance gap where origin-only validation could otherwise accept a valid-integrity tarball for the wrong package or version from the public npm registry.

The handoff manifest closes a separate stale-artifact gap. Bridge CI artifacts are retained for seven days, so a reviewer can otherwise download an authentic pair after the branch has advanced and accidentally review it as though it came from the newer source tree. `scripts/lockfile-handoff-manifest.mjs` makes that mismatch explicit: artifact review must use the source commit recorded in the manifest, and any change to either lockfile or either package manifest invalidates the recorded digest. Recording the exact Node and npm versions also prevents an artifact produced by a different runtime/resolver combination from being treated as equivalent merely because it ran on the same Node major line.

The adoption helper turns that evidence into a fail-closed repository boundary instead of relying on a manual copy step. Run it from `bridge/` with the extracted workflow artifact directory. If the branch has advanced, either source manifest changed, either downloaded lockfile changed, the manifest describes an unexpected file set, the generator versions differ from the reviewed Node `22.23.2` / npm `10.9.8` pair, or a repository lockfile is already present, adoption stops before replacing repository state.

Focused dependency-free `node:test` coverage includes canonical unscoped/scoped registry entries, rejection of package-name/version/tarball-filename mismatches, exact handoff verification, stale lockfile rejection, wrong-source-commit rejection, rejection of another Node 22 release, rejection of a non-Node-22 release, rejection of unreviewed npm resolver evidence, successful source-bound adoption, rejection of a source-manifest mismatch, rejection of a wrong-commit artifact, rejection of an artifact produced by another Node 22 release, refusal to overwrite an existing repository lockfile, exact generator Node/npm acceptance plus rejection of Node/npm drift, exact package-manager/Node-engine validation, exact per-job Node pin validation, rejection of workflow jobs that omit their own setup-node version, and rejection of workflows that remove the explicit toolchain-policy guard. These checks can run before dependency installation.

## Human handoff review

After a registry-backed Bridge CI run produces a paired lockfile artifact, review both lockfiles and the handoff manifest from the same run before committing them:

- [ ] Read `lockfile-handoff-manifest.json` and confirm its `source.commit` is the exact Bridge branch revision being reviewed; do not apply a retained artifact to a newer head without regenerating it.
- [ ] Confirm the manifest records the expected Bridge ref, Node `v22.23.2`, and npm `10.9.8` exactly.
- [ ] Extract the artifact into a separate directory and run `npm run lockfiles:adopt -- --artifact <dir>` from `bridge/`; do not manually copy or edit either lockfile into place.
- [ ] Confirm the root graph contains the expected direct dependencies already pinned in `bridge/package.json`.
- [ ] Confirm the signaling runtime graph is rooted only in the reviewed `ws` runtime dependency from `bridge/server/package.json`.
- [ ] Review newly resolved transitive packages for unexpected package families, install behavior, or platform-specific expansion.
- [ ] Prefer the `bridge-lockfiles` artifact from a successful full-validation run because it proves typecheck, unit/integration tests, builds, browser checks, and the disposable local-coturn relay test passed against that exact graph. A `bridge-generated-lockfile-pair` artifact from `lockfiles_only=true` is provenance/integrity handoff evidence only and must still be followed by the full validation run.
- [ ] Commit `bridge/package-lock.json` and `bridge/server/package-lock.json` together; never commit only one side of the pair. The handoff manifest is review evidence and is not a production runtime dependency.
- [ ] Remove the temporary workflow lockfile-generation path and make CI/deploy consume only the committed pair with `npm ci`.

Production hosting, signaling origins, and TURN credentials are not inputs to this review. The only external prerequisite is a functioning connection to the public npm registry so npm can generate authentic lockfile resolution and integrity metadata.
