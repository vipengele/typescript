---
about: .gt-repo.yaml
saw: 20260923
---

gt 2.0.0 removed `bulwark` entirely (the `bulwark:` spec key, `reusable-bulwark.yml`, everything)
in favor of `lydite`, configured under a `lydite:` key in `.gt-repo.yaml` (see `gt repo config`
for the resolved spec). `gt repo sync` after bumping `gt_version` rewrites
`.github/workflows/ci-orchestration.yml`'s reusable workflow refs from `@v1` to `@v2` and adds
`.github/workflows/lydite-clearance.yml` (answers a `/lydite clear` PR comment — needed once
`lydite/referral` becomes a required branch-protection check alongside `ci-gate`).

lydite runs each `.lydite/components.yml` component's test suite itself, instrumented — it does
not consume a pre-built coverage report the way bulwark did (bulwark read `.bulwark.yml`'s
`coverage.source: report` config and an artifact `ci-test.yml` staged for it). Migrating off
bulwark means deleting `.bulwark.yml` and the coverage-artifact staging/merging steps in
`ci-test.yml`/`ci-build.yml` — they have no consumer anymore.

Known gap as of gt 2.0.0 (upstream-tracked, not something a consuming repo's config can fix):
`lydite/referral`'s clearance isn't scoped to a verified App identity yet, so anything with repo
write access can currently satisfy the check without going through `/lydite clear`.
