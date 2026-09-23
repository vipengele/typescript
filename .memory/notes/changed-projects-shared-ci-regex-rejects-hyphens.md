---
name: changed-projects-shared-ci-regex-rejects-hyphens
kind: gotcha
description: changed-projects treats only ci-<letters>.yml as shared CI, so a hyphenated ci-foo-bar.yml change selects no project.
anchors:
  - path: .github/actions/changed-projects/action.yml
    blob: d2e0ff8b8030
  - path: .github/workflows/ci-*.yml
    matches:
      - path: .github/workflows/ci-build.yml
        blob: 00ef4adcdb13
      - path: .github/workflows/ci-orchestration.yml
        blob: 58030e7bf716
      - path: .github/workflows/ci-preflight.yml
        blob: f7818da4ffc6
      - path: .github/workflows/ci-test.yml
        blob: 0cf5f58cf5dc
confidence: verified
---

`.github/actions/changed-projects/action.yml:52` decides whether a diff touched a shared CI file,
and if so selects every project:

```
grep -qE '^(\.github/(workflows/ci-[a-z]+\.yml|actions/)|\.lydite/)'
```

`ci-[a-z]+\.yml` has no room for a hyphen or digit. Today's `ci-build.yml`, `ci-orchestration.yml`,
`ci-preflight.yml` and `ci-test.yml` match only because each is one lowercase word. A new stage
called `ci-code-scan.yml` or `ci-e2e.yml` does not match. If a diff touches only that file and
nothing under `source/`, `action.yml:58-61` returns `[]`, and the build and test matrices skip
every project (`ci-build.yml:57`, `ci-test.yml:41`). The new stage then never gets exercised
against a project in its own PR.

When you add a shared CI stage, either name it `ci-<oneword>.yml` or widen the class to
`[a-z0-9-]+`.
