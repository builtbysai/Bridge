# Lockfile staging safety

Bridge generates two release-critical npm lockfiles: the full build/test graph at `bridge/package-lock.json` and the minimal signaling runtime graph at `bridge/server/package-lock.json`.

Generation must not update those repository files one at a time while dependency resolution is still in progress. `scripts/generate-lockfiles.mjs` therefore creates an isolated temporary workspace, copies only the reviewed package manifests into it, resolves both graphs against the credential-free public npm registry configuration, and validates both staged lockfiles with `validateLockfilePolicy` before publishing either repository lockfile.

This staging boundary prevents a normal second-stage resolution or policy failure from leaving a newly generated first lockfile in the working tree. It complements, rather than replaces, the existing provenance controls: Node 22 is required; ambient npm configuration and authentication variables are stripped; registry resolution is pinned to `https://registry.npmjs.org/`; linked/unresolved packages fail closed; and registry packages require canonical SHA-512 integrity metadata.

Both resulting lockfiles must still be reviewed and committed together. Do not hand-author either file or repair a failed generation by copying guessed dependency or integrity metadata into the repository. A functioning npm registry connection is required to complete this gate.

`verify-supply-chain-workflows.mjs` enforces the staging contract by requiring separate temporary Bridge/runtime roots, validation of both staged graphs, and publication only through the post-validation publication helper. Once reviewed lockfiles are committed, the temporary generation path should be removed from normal CI/deploy and all release validation should consume the committed lockfiles with `npm ci`.
