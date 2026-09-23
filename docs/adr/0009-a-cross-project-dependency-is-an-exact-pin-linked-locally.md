# A cross-project dependency is an exact pin, linked locally

A project that depends on a sibling project's package names it in its manifest at the exact release
version, and its `pnpm-workspace.yaml` overrides that name with a `link:` to the sibling's package
directory:

```yaml
# source/ts/pnpm-workspace.yaml — never published
overrides:
  "@vipengele/ts-core-common": "link:../core/packages/common"
```
```jsonc
// source/ts/packages/ts/package.json — what consumers install
"dependencies": { "@vipengele/ts-core-common": "0.0.2" }
```

This answers the question ADR-0001 left open and ADR-0003 deferred: how a project consumes a
sibling's version that the same release is about to publish.

## Why

A release sets every project to one version X in one change. A manifest naming a sibling at X
cannot be installed from the registry in that change's CI, because X is published only by the tag
that follows it — `--frozen-lockfile` fails whatever the range or pin, and `minimumReleaseAge`'s
`@vipengele/*` exclusion does not help with a version that does not exist.

Inside one project this never arises: `workspace:*` links the sibling locally and `pnpm publish`
rewrites it to the exact version, which is how `@vipengele/ts-core-observability` 0.0.1 came to
depend on `@vipengele/ts-core-common` 0.0.1. The override recreates that across projects:

- Installing, building and testing never ask the registry for the sibling; the lockfile records a
  link, so `--frozen-lockfile` passes in the release change.
- The published manifest keeps the exact pin — overrides live in `pnpm-workspace.yaml`, which is not
  packed — so a consumer gets packages from one release, which is what ADR-0001's single version
  promises. ADR-0001's publish order puts the sibling on the registry first.
- The dependent builds against the sibling's current code, so an entry point added in a release can
  be re-exported by the umbrella in the same release.
- A linked package contributes none of its own dependencies to the dependent's lockfile, so each
  project still owns its toolchain and lockfile (ADR-0001).

Verified against pnpm 12.4 with `trustPolicy: no-downgrade` and `blockExoticSubdeps: true`: the
install, a frozen reinstall, the build, the type-check and `pnpm pack` all behave as described.

## What it requires

- **The release sets the pins.** Setting the version in every project also sets every `@vipengele/*`
  dependency across projects to it, and the release workflow's check that every manifest carries the
  tag's version covers those pins.
- **Siblings build first.** The link points at the sibling's `dist/`, so CI and the release `build`
  job build a project's cross-project dependencies before the project itself.
- **Change detection selects dependents.** A change to a project also selects every project that
  links it.
- **Every cross-project dependency has both halves**: the exact pin in the manifest and the `link:`
  override in the workspace. A pin without its override installs from the registry and fails in the
  release change; an override without its pin publishes a manifest that does not name the sibling.

## Considered options

- **Depend on the previous release and bump afterwards.** The dependent always trails by a release,
  and an entry point cannot be re-exported in the release that adds it.
- **A root workspace spanning every project.** Violates "all code lives under `source/`" and
  couples every project to one lockfile (ADR-0001).
- **Move the umbrella into `core`.** `workspace:*` would work today, and the problem returns with the
  first second project the umbrella re-exports.
- **Peer dependencies only.** The same install problem, and every consumer then matches versions by
  hand.
- **A release-time rewrite of a range to the new version.** The dependent is built and tested against
  the previous release, not the code being released.
