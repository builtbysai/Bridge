# Checkout credential isolation

Bridge CI and Bridge Deploy must not leave the GitHub workflow token in repository git configuration for later dependency, build, test, or packaging commands.

## Release invariant

Every `actions/checkout` step in the two Bridge-specific workflows must set:

```yaml
with:
  persist-credentials: false
```

The setting is required on the checkout step itself. A `persist-credentials: false` key elsewhere in the workflow does not satisfy the policy.

`bridge/scripts/verify-checkout-credentials.mjs` is dependency-free and runs before registry/dependency work in both Bridge workflows. It enumerates each `actions/checkout` step, finds that step's own `with:` block, and fails closed unless `persist-credentials: false` is nested there. It also fails when a reviewed Bridge workflow contains no checkout step.

Focused `node:test` regression coverage verifies:

- a correctly isolated checkout is accepted;
- a checkout missing the setting is rejected;
- an unrelated later `persist-credentials: false` cannot satisfy an unsafe checkout;
- one safe checkout cannot mask another unsafe checkout even when global counts appear correct; and
- a workflow with no checkout fails closed.

## Release review

Before release, keep all of the following true:

- [x] Bridge CI checkout disables credential persistence.
- [x] Bridge Deploy checkout disables credential persistence.
- [x] Both workflows run the step-local credential isolation verifier before dependency installation.
- [x] The verifier's regression suite is part of `npm run test:lockfile-policy`.
- [ ] Re-run the dependency-free policy suite and the full dependency-backed release suite in a functioning CI/development environment before production deployment.

This guard limits accidental workflow-token exposure through checkout-managed git credentials. It does not replace the workflows' top-level `contents: read` permission boundary, immutable action pins, or external secret-management requirements.
