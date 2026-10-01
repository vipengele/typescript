---
name: cross-project-dependency-is-dependencies-field-only
kind: invariant
description: Every cross-project-dependency consumer scans only a package's `dependencies`, so a sibling listed under peer/optionalDependencies is invisible to CI and release.
anchors:
  - path: .github/actions/build-cross-project-deps/build.sh
    blob: 1ce8ddb72f9d
  - path: .github/actions/verify-cross-project-deps/verify.sh
    blob: 3c2417c05126
  - path: .github/actions/changed-projects/action.yml
    blob: 7a9cd9a5c3eb
  - path: agentic/skills/release/SKILL.md
    blob: 56082583b642
confidence: verified
---

build-cross-project-deps (`build.sh:37`), verify-cross-project-deps (`verify.sh:48`),
changed-projects (`action.yml:76`) and the release skill's pin rewrite (`SKILL.md:57`) all read
only `.dependencies`. Build and changed-projects once also matched peer/optional dependencies; a
review on issue #71 caught that the pin and `link:` override of such an edge were then never
verified, and both were narrowed. ADR-0009 rejects "peer dependencies only" as a design.

A sibling-project package named in `peerDependencies` or `optionalDependencies` is therefore not a
cross-project dependency at all: nothing builds it, selects its dependent, or checks its `link:`
override. Keep new consumers of this edge consistent with the four above.
