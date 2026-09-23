# Vipengele TypeScript

The `vipengele/typescript` repo: the TypeScript framework of the vipengele platform, holding
**projects** — each a self-contained pnpm workspace under `source/<project>/`. Every project is
released on one tag `vX.Y.Z`, at one version, dependencies first (ADR-0001). See `CONTEXT.md` for
the glossary (Project, Package, Runtime, Redaction, Logger, Category, Log Record, Sink, Reporter,
Error Event, Scope, Breadcrumb, Transport) before naming things.

**No code at the repo root** — everything that builds, tests or ships lives under `source/`
(`agentic/rules/all-code-lives-under-source.md`).

## Layout

- `source/<project>/` — one pnpm workspace per project, with its own `pnpm-workspace.yaml`,
  lockfile, `turbo.json`, `tsconfig.base.json`, `vitest.shared.ts` and `biome.json`. A
  cross-project dependency is a published range, never `workspace:*`.
- `source/core/` — the framework's foundation:
  - `packages/common` — `@vipengele/ts-core-common`: shared types and primitives (context
    propagation, error normalization, runtime detection) the other packages agree on.
  - `packages/redaction` — `@vipengele/ts-core-redaction`: the reusable redaction library.
  - `packages/observability` — `@vipengele/ts-core-observability`: the logger (`./logger`) and the
    error reporter (`./errors`), two entry points of one package.
- `.github/actions/changed-projects` — the projects a change affects; CI builds only those.
- `docs/adr/` — architecture decision records. Read before revisiting a decision recorded there.
- `docs/release-notes/` — one file per release, named after its tag (`vX.Y.Z.md`). The release
  workflow refuses to publish without it.

## Commands (run from `source/<project>`)

```bash
pnpm build          # turbo run build — tsup bundles, tsc emits declarations, in dependency order
pnpm type-check     # turbo run type-check
pnpm test           # turbo run test — vitest under Node and Chromium, 100% v8 coverage, gated by lydite
pnpm lint           # biome lint . --error-on-warnings
pnpm format:check   # biome format .
```

The browser half of the suite needs Chromium once: `pnpm exec playwright install chromium`.

## Runtimes

Every package runs unchanged in the browser and in Node 24+. `vitest.shared.ts` runs each
`*.test.ts` in both a `node` and a `chromium` Vitest project; a suite that only makes sense in one
runtime is named `*.node.test.ts` or `*.browser.test.ts`. Coverage is the union of both runs.
Runtime-specific code is chosen by feature detection or conditional `exports`, never by assuming
`window` or `process` exists.

## Packages

ESM only, `"sideEffects": false`, `files: ["dist"]`, zero runtime dependencies outside the
framework unless a package says why. `@opentelemetry/api` is an optional peer where trace
correlation needs it — a consumer without OpenTelemetry pays nothing.

## Workspace and dependency policy

- `@vipengele/*` packages publish to the public npm registry; installing and building need no token.
- A project's `pnpm-workspace.yaml` enforces `minimumReleaseAge`, `trustPolicy: no-downgrade`, and
  `blockExoticSubdeps: true` for supply-chain hygiene, plus `overrides` for specific
  provenance-driven pins (see the comments in that file before touching `overrides`).
- New dependencies with a postinstall script need an entry in the project's `pnpm-workspace.yaml`
  `allowBuilds`, or pnpm silently skips the script.

## CI

- `.github/actions/changed-projects` lists the `source/` projects a diff touches. A change to a
  shared CI file (`ci-*.yml`, that action, `.lydite/`) selects every project; a change that
  touches no project (docs, agentic instructions) selects none and the stages skip.
- `ci-build.yml` runs, per affected project, `pnpm lint`, `pnpm format:check`, `pnpm build`,
  `pnpm type-check`.
- `ci-test.yml` installs Chromium and runs `pnpm test` per affected project. The `lydite` stage
  gates coverage separately, running each `.lydite/components.yml` component's suite itself.

## Release

A release is one tag, `vX.Y.Z`, pushed by a human (ADR-0001). The `release` skill walks the whole
sequence.

- `release.yml`: `tag` validates the tag, requires `docs/release-notes/<tag>.md` and computes the
  publish order; `build` is a credential-free matrix over every project; `publish` holds the OIDC
  token, verifies the artefacts carry nothing but `dist/`, and publishes each project in dependency
  order with provenance; `announce` creates the GitHub Release. Publishing is idempotent.
- A brand-new package name must be created by a one-time manual publish before a trusted publisher
  can be enrolled on it.
