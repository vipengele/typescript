# The `@vipengele/ts` umbrella package is a naming exception with a deferred dependency

`source/ts/packages/ts/` holds `@vipengele/ts`, the framework's batteries-included package. Most
consumers install this one package and import everything they need through it; a consumer using a
bundler who wants to tree-shake can instead reach into a specific package directly, or a sub-path
of one — `@vipengele/ts-core-common/types/numeric`, for instance — and pull in nothing else. The
umbrella exists so the common case needs one dependency, not a table of which `@vipengele/ts-*`
package holds which export.

## Why the name breaks the project-scoped convention

ADR-0001 names every package `@vipengele/ts-<project>-<package>`, so the project a package belongs
to is always legible from its name. `@vipengele/ts` has no such segment — it is exactly
`@vipengele/ts`, with nothing appended. This is a deliberate, one-time exception, not a precedent:
the umbrella package's entire purpose is to *be* the name of the framework, and a name like
`@vipengele/ts-ts-umbrella` would defeat that purpose while gaining nothing over the packages it
wraps. A future project — a hypothetical `source/web` shipping `@vipengele/ts-web-http-client`,
say — keeps the ordinary convention. Only the umbrella is exceptional, because only the umbrella
needs to be the framework's own name.

## Why it ships now, empty

`source/ts/packages/ts/` currently has no functionality: it declares the package, its exports
shape, and its README, and nothing else. Establishing the umbrella's shape — its name, its
workspace, its naming exception — costs least while nothing yet depends on the shape being any
particular way. Once real consumers exist, changing the umbrella's name or its place in the
workspace graph is a breaking change for anyone already depending on it; setting the shape now, on
the framework's first real component, avoids paying that cost later.

## Why it has no dependency on `@vipengele/ts-core-common` yet

This is a hard technical constraint, not a scope decision. Every package in this repo is still at
`0.0.0`, and nothing has ever been published to the npm registry under `@vipengele/*` — `git tag`
on this repo is empty. A published-range dependency on `@vipengele/ts-core-common` would need a
real version of that package on the registry to resolve against; since none exists, `pnpm install
--frozen-lockfile` for `@vipengele/ts` fails in its own CI regardless of which range or pin
strategy the dependency uses. `@vipengele/ts` ships with zero `@vipengele/*` dependencies until
`@vipengele/ts-core-common` has a first published version to depend on.

This does not resolve ADR-0001's open question about how a project consumes a sibling's version
that the same release is about to publish — that question is still open. It only explains why
`@vipengele/ts` does not yet attempt to answer it: there is no published sibling version to
consume, deferred or otherwise.

A follow-up gives `@vipengele/ts` a real dependency on `@vipengele/ts-core-common` and re-exports
`Numeric` and the rest of `common`'s public surface, once a release has actually put
`@vipengele/ts-core-common` on the registry. That is also when ADR-0001's open question needs an
answer: which pin strategy the umbrella's dependency uses is only decidable against real registry
state, not against a package that has never been published.

## Why `source/ts/packages/ts/`, not a flat `source/ts/`

`release.yml`'s publish-order computation globs `source/*/packages/*/package.json`, and the
release skill's use of `pnpm -r` excludes the workspace root package unless a package there is
explicitly included in the workspace's package list. A `package.json` sitting directly at
`source/ts/` is invisible to both: it never enters the publish order and `pnpm -r` never touches
it. Nesting under `packages/ts/`, the same layout `source/core/` uses for its three packages,
makes `@vipengele/ts` visible to the same tooling every other package already relies on. The
project will likely only ever hold this one package, so the nesting adds a directory level without
adding real structure to maintain.

## Considered options

- **Keep the strict `@vipengele/ts-<project>-<package>` convention and pick a project-scoped name**
  — `@vipengele/ts-umbrella-ts`, or similar. Consistent with every other package, but a
  batteries-included package whose whole appeal is a short, memorable install name loses that
  appeal the moment its name is as long as the packages it re-exports.
- **Ship the umbrella with a real dependency anyway, pinned some workaround way** (a git
  dependency, a `file:` reference, an `overrides` entry). Rejected: it would pass locally but fail
  the moment CI runs `pnpm install --frozen-lockfile` against the real, empty registry state, and
  it commits the repo to a pin strategy chosen before there is anything real to pin against.
- **Wait to create the umbrella until after `@vipengele/ts-core-common`'s first real release.**
  Avoids the empty-package period entirely, but means the umbrella's name, workspace layout and
  naming exception get decided later, after other packages and consumers may already assume a
  different shape. Setting the shape now, while it is still free to set, is preferred.

## Consequences

`@vipengele/ts` is a real, installable package that does nothing until its follow-up lands — its
`package.json`, exports shape and README exist, but importing it re-exports nothing yet. Anyone
scanning package names for the `@vipengele/ts-<project>-<package>` pattern needs to know this one
name is the documented exception, not a mistake. ADR-0001's cross-project dependency-versioning
question remains open, and is now explicitly blocking for whichever change gives `@vipengele/ts`
its first real dependency.
