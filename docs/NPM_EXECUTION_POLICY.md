# npm executable resolution policy

Bridge release validation must execute only package binaries that are already present in the dependency graph produced from the reviewed/generated lockfile pair.

## Policy

- Workflow dependency installation uses `npm ci --ignore-scripts` so dependency lifecycle hooks do not execute during the reviewed install boundary.
- Workflow `npx` invocations must include `--no-install`.
- A missing local executable is therefore a hard validation failure instead of an opportunity for `npx` to download a package that was not present in the reviewed lockfile.
- GitHub Action references remain pinned to immutable full commit SHAs separately from this npm executable rule.

Bridge CI currently uses this boundary for Playwright browser installation:

```sh
npx --no-install playwright install --with-deps chromium firefox webkit
```

`@playwright/test` is a pinned development dependency. If its expected executable is absent after `npm ci`, CI must fail rather than resolve another package from the registry.

## Enforcement

`bridge/scripts/verify-supply-chain-workflows.mjs` scans both Bridge workflow files and rejects any `npx` command that does not contain `--no-install`. The focused dependency-free regression suite in `verify-supply-chain-workflows.test.mjs` covers unsafe and safe forms.

## Release review checklist

- [x] Bridge workflow `npm ci` commands suppress dependency lifecycle scripts.
- [x] Bridge workflow `npx` commands fail closed with `--no-install`.
- [x] Playwright browser installation uses the executable from the reviewed dependency graph.
- [x] Dependency-free regression coverage prevents accidental removal of the rule.
- [ ] After genuine registry-generated lockfiles are committed, run the full dependency-backed Bridge validation suite from those committed lockfiles.
