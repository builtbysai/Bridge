# Bridge build artifact integrity

`Bridge Deploy` produces an isolated Bridge release artifact for later operator-controlled deployment. It contains both the static frontend and a compiled Node 22 signaling runtime. Until a hosting target is selected, the workflow does not deploy anything and does not require production credentials.

## Integrity manifest

After `npm run build` and `npm run build:server`, the workflow copies the minimal signaling runtime manifest into `dist-server/package.json`, then creates `bridge/bridge-artifacts.sha256` by enumerating every regular file under `dist/` and `dist-server/` in bytewise sorted path order and hashing each file with SHA-256. It runs `sha256sum --check bridge-artifacts.sha256` before upload.

The uploaded `bridge-release` artifact contains:

- `bridge/dist/**` — the static frontend artifact
- `bridge/dist-server/**` — compiled signaling JavaScript plus the minimal production runtime `package.json`
- `bridge/bridge-artifacts.sha256` — the file-by-file SHA-256 manifest covering both deployable pieces

The dependency-free release preflight requires the deploy workflow to compile/package the signaling runtime and generate, verify, and upload this manifest so the production artifact contract cannot be silently removed.

## Operator verification

Before deploying a downloaded artifact, run the verification from the directory that contains `dist/`, `dist-server/`, and `bridge-artifacts.sha256`:

```sh
sha256sum --check bridge-artifacts.sha256
```

Treat any missing file, extra unexpected build output, or digest mismatch as a failed release artifact. Do not deploy a partially verified artifact.

The manifest proves that the files being deployed match the files uploaded by the workflow; it is not a code-signing or identity mechanism. GitHub Actions permissions, immutable action pins, branch review, and repository controls remain separate parts of the release trust boundary.

## Signaling runtime handoff

`dist-server/` is intended to run on Node 22 without the development-only `tsx` loader. Its copied `package.json` contains only the production WebSocket runtime dependency and starts the compiled entry point with `node signaling.js`. A production platform should install runtime dependencies inside this directory using the release lockfile once that lockfile exists, then start the declared command.

Do not substitute `server/signaling.ts` plus `tsx` in production when the compiled artifact is available. Provider-specific process management, TLS termination, scaling, and secret/configuration injection remain operator concerns.

## Rollback

Keep the manifest beside each retained known-good artifact. Before rollback, verify the retained frontend and signaling runtime against their own manifest instead of assuming cached or downloaded files are unchanged.

## Reproducibility status

This integrity check does not replace a registry-generated `package-lock.json`. Bridge still requires a real npm-generated lockfile and conversion of CI/deploy installation to `npm ci` before transitive dependency resolution is reproducible. The signaling runtime manifest intentionally pins its direct runtime dependency, but its transitive install also needs a registry-generated lockfile before release. Do not hand-author lockfile integrity metadata.
