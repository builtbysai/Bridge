# Workflow token permission policy

Bridge CI and Bridge Deploy use the repository token only to read source. Their reviewed permission boundary is exactly:

```yaml
permissions:
  contents: read
```

A top-level read-only declaration is not sufficient by itself because GitHub Actions permits a job-level `permissions:` block to override the workflow default. A later job-level override could therefore grant write or OIDC access while a simple top-level check still passed.

`npm run verify:workflow-permissions` is dependency-free and reviews both Bridge workflow files before registry or dependency work. It fails closed unless each workflow contains exactly one `permissions:` declaration, that declaration is at workflow top level, and its only entry is `contents: read`. Inline shorthands, extra scopes such as `id-token: write`, missing declarations, and any job-level permission override are rejected.

## Release checklist

- [x] Bridge CI declares only top-level `contents: read`.
- [x] Bridge Deploy declares only top-level `contents: read`.
- [x] Both workflows run `verify:workflow-permissions` before lockfile generation or dependency installation.
- [x] Dependency-free regression coverage rejects job-level overrides, extra scopes, shorthand declarations, and missing declarations.
- [ ] If Bridge later needs another token capability, review the least-privilege requirement explicitly and update this policy, tests, and both workflows in the same change. Do not add a one-off job-level override.
