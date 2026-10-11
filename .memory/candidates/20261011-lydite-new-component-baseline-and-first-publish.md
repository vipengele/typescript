---
about: lydite baseline handling of a new component is in the external gt reusable workflow (not readable here); release.yml does not fail a never-published package, it treats 404 as "publish it" but a trusted publisher still needs the manual first publish
saw:
  - .lydite/components.yml
  - .lydite/config.yml
  - .github/workflows/ci-orchestration.yml
  - .github/workflows/release.yml
---
- Baseline is not stored in-repo: no baseline file under .lydite/ (only components.yml, config.yml). ci-orchestration.yml:172-186 runs `lydite-baseline` (reusable-lydite-baseline.yml@v2 from pedromvgomes/gt) only on `push` to the default branch with contents: write, so it records after merge, not in the PR. The PR gate is `lydite` (ci-orchestration.yml:147-165, reusable-lydite.yml@v2), publishing the required `lydite/referral` status; ci-gate needs it (:193).
- What the gate does for a component absent from the baseline is inside the external reusable workflow/lydite binary and was NOT read. Only in-repo evidence: commit 0f0f00f (#113) comment in components.yml says "a component with no measurement leaves the baseline without an entry for it, and a partial baseline is never recorded" - i.e. an unmeasurable component stalled baseline recording, so it was removed (ts component dropped, source/ts/packages/ts/** added to excludes). That concerns no measurement, not a new measured component.
- release.yml:430-437: per package, registry GET .../<name>/<VERSION>: 200 skip, 404 add to publish filters, other status exits 1. So a never-published name is a 404 and is queued for publish, not an error. dist-tags lookup (:441-444) uses `--fail ... || true` then `[ -z "$current" ] && continue`, so a never-published package (no latest) is tolerated. The failure is at publish time instead: npm trusted publishing (OIDC) cannot enrol a publisher on a name the registry lacks (header comment release.yml:25-28), so the first publish must be manual.
