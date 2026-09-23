# Projects release together, at one version, dependencies first

The repo is `vipengele/typescript`: the TypeScript framework of the vipengele platform. Inside it,
each **project** lives in `source/<project>/` as its own pnpm workspace — its own
`pnpm-workspace.yaml`, lockfile, `turbo.json`, `tsconfig.base.json`, `vitest.shared.ts` and Biome
config. `source/core/` is the first, holding `@vipengele/ts-core-common`,
`@vipengele/ts-core-redaction` and `@vipengele/ts-core-observability`. Package names carry the
project: `@vipengele/ts-<project>-<package>`.

Everything that builds, tests or ships lives under `source/`. The repo root holds only what crosses
projects: `.github/`, `agentic/`, `.memory`, `.lydite`, `.serena`, the gt config, `docs/` and
`CONTEXT.md`.

A release is one tag, `vX.Y.Z`, the version of the whole framework. One workflow publishes every
non-private package of every project at that version. It builds the projects in parallel in a
credential-free matrix, then publishes them **one after another in dependency order**: a project
publishes only once every project it depends on is on the registry. The order is a topological sort
of the cross-project dependency graph read from the manifests, and a cycle between projects fails
the release before anything is published. Within a project `pnpm publish -r` orders the packages
itself. The publishing mechanics are vipengele/react's: a human pushes the tag, the `build` job
holds no credentials and hands `dist/` to a `publish` job that authenticates with npm trusted
publishing (OIDC, `--provenance`, environment `npm-release`), and a re-run finishes a partial
publish. Each package name is created once with a `0.0.0` placeholder before its trusted publisher
can be enrolled.

## Why one version for every project

This is a framework, and its consumers install several of its packages side by side. One version
answers "which releases of these go together" without a compatibility table, and a cross-project
change ships in one release instead of a producer release followed by a consumer release.

## Why a project is still its own workspace

A project is the unit that owns its toolchain and its dependency graph, and it is what CI selects
from a diff. Inside a project, internal dependencies are `workspace:*`, which pnpm packs as exact
pins. Across projects a dependency is an ordinary published range, as in vipengele/react
(its ADR-0015), which keeps one project's lockfile and tool upgrades from forcing another's.

## Considered options

- **Per-project tags (`<project>@vX.Y.Z`), as vipengele/react does.** Each project versions on its
  own; a consumer of several projects has to know which versions are compatible.
- **One workspace spanning every project.** Removes the published-range seam between projects, but
  couples every project to one lockfile and one toolchain version.
- **A parallel publish matrix.** Simpler workflow, but a dependent project can land on the registry
  before the project it depends on.

## Consequences

Every project is released on every tag, including projects with no change since the last one. Each
project pays for its own lockfile and tool config, and Dependabot needs one entry per project
directory. A change to shared root CI files selects every project. How a project consumes a
sibling's version that the same release is about to publish is an open question, tracked as its own
decision before a second project with a cross-project dependency lands.
