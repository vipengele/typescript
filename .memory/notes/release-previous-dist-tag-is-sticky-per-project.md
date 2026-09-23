---
name: release-previous-dist-tag-is-sticky-per-project
kind: gotcha
description: Release picks one dist-tag per project; if any package's registry latest is newer, the whole project publishes under `previous`.
anchors:
  - path: .github/workflows/release.yml
    blob: 18aa2e38a5a7
confidence: verified
---

In `.github/workflows/release.yml`, the `publish` job sets `dist_tag=latest` once per project
(`release.yml:415`). It then loops over every non-private package name and asks the registry for
that package's `latest` (`release.yml:434-436`). If any one of them is newer than `VERSION`
(`sort -V`, `release.yml:440`), `dist_tag=previous` (`release.yml:442`). Nothing in the loop
sets it back to `latest`. A single `pnpm publish --tag "$dist_tag"` then publishes all of the
project's filtered packages (`release.yml:450`).

The result is that the decision is effectively an OR across the project. One package whose
`latest` is ahead puts every package published in that project under `previous`, including
siblings for which `VERSION` would have been the new `latest`. The check also covers packages
that are already on the registry at `VERSION` and are not being published (the dist-tag lookup
at `:434` runs even after the `200` case at `:426`).

The guard exists because npm moves `latest` to whatever was published last. An out-of-order
publish without the guard would move `latest` backwards.
