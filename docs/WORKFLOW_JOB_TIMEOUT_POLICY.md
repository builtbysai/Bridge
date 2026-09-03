# Bridge workflow job timeout policy

Bridge CI and Bridge Deploy are release-sensitive workflows. Every explicit job must have its own `timeout-minutes` value so that adding a second job cannot silently create an unbounded runner execution path.

## Enforced contract

`bridge/scripts/verify-workflow-job-timeouts.mjs` parses the top-level `jobs:` mapping in both Bridge-specific workflows and fails unless:

- at least one explicit job exists;
- every job defines `timeout-minutes` exactly once;
- every timeout is an integer between 1 and 60 minutes.

The parser is intentionally dependency-free so this policy can run before registry-backed dependency installation. Focused `node:test` coverage verifies multi-job workflows, missing timeouts, duplicate timeout declarations, out-of-range values, and the no-jobs fail-closed case.

## Release checklist

- [x] Bridge CI has an explicit bounded job timeout.
- [x] Bridge Deploy has an explicit bounded job timeout.
- [x] Both workflows execute the dependency-free per-job timeout verifier before dependency installation.
- [x] Regression coverage proves a newly added job without its own timeout is rejected.
- [ ] Keep this guard when the workflows are later split into multiple jobs or re-enabled for automatic triggers.

This guard does not replace GitHub-hosted runner limits or external deployment controls; it prevents repository workflow drift from weakening Bridge's reviewed execution boundary.
