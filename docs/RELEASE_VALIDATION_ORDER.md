# Release validation ordering

Bridge's dependency-free supply-chain verifier treats release validation as an ordered gate, not a set of commands that may appear anywhere in a workflow.

For Bridge CI, lockfile policy and registry-backed generation must happen before `npm ci`; advisory and SBOM generation must happen before typecheck, unit/integration tests, frontend/server builds, browser checks, and the local TURN relay check. The generated dependency SBOM and lockfile pair are review artifacts, so neither is uploaded until all of those validation steps, including the relay-only local-coturn test, have succeeded. A failed validation run therefore cannot leave behind a newly published SBOM or lockfile artifact that could be mistaken for a fully validated review handoff.

For Bridge Deploy, lockfile policy/generation, clean install, advisory/SBOM review, typecheck, tests, and both builds must all precede production-runtime install/audit/SBOM verification. Runtime verification must precede artifact checksum generation, checksum verification, and the `bridge-release` upload.

`bridge/scripts/verify-supply-chain-workflows.mjs` fails if these required operations are present but reordered across the reviewed boundary. In CI it specifically requires `npm run test:e2e:turn` to precede both `bridge-dependency-sbom` and `bridge-lockfiles` publication. This prevents a workflow edit from publishing review or release artifacts before the dependency-backed validation intended to gate them.

This ordering check does not replace execution of the workflows. Registry-generated committed lockfiles and a successful dependency-backed validation run remain release requirements.
