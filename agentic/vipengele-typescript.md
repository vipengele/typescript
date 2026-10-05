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
  cross-project dependency is an exact pin in `dependencies`, overridden by a `link:` in
  `pnpm-workspace.yaml` to the sibling's package directory — never a `workspace:*` link or a
  published range (ADR-0009).
- `source/core/` — the framework's foundation:
  - `packages/common` — `@vipengele/ts-core-common`: shared types and primitives (context
    propagation, error normalization, runtime detection, locales) the other packages agree on. A
    sub-path like `./types/numeric` (`Numeric.parse`/`tryParse`/`format`, which take a `./locale`
    `Locale` — a validated BCP 47 tag with month and weekday names, hour cycle and first day of the
    week — ADR-0013), `./types/date-time` (`LocalDate`, `LocalTime`, `LocalDateTime`: validated,
    immutable, zoneless civil values with ISO 8601 parse/format, arithmetic, `now()`, locale-aware
    `format`/`parseLocalized`/`tryParseLocalized` and `LocalDate#segments`; `Instant`, a
    nanosecond point on the UTC timeline; `ZoneId`, a named time zone with `offsetSecondsAt`; `ZonedDateTime`, a date and time of day in a
    zone, built by `LocalDateTime#atZone`, `LocalDate#atStartOfDay` and `Instant#atZone`, with a
    `disambiguation` option settling a skipped or repeated local time, a `ZoneResolutionError` for
    `reject`, and a strict ISO parse; ADR-0015) or
    `./context` (`createAsyncContextStore`, a value carried across an async call chain behind a
    fixed carrier fallback — `AsyncLocalStorage`, then `AsyncContext.Variable`, then a synchronous
    stack, ADR-0004; state shared across dual-resolved copies of the package lives behind a
    `globalThis` registry, `agentic/rules/shared-realm-state-lives-behind-a-globalthis-symbol-slot.md`)
    is a tree-shakeable slice of the package's surface, not a separate package — a bundler-using
    consumer imports only the sub-path it needs. `./scope` is one such sub-path: `Scope`
    (`current`/`propagate`/`inherit`/`isolated`/`useCarrier`), the ambient context tree the logger
    and the error reporter both read attributes from, built on `./context`'s store; its root holds
    the four reserved `Resource` keys (`service.name`, `service.version`,
    `deployment.environment.name`, `process.runtime.name`) and which `Scope.resource()` reads back as a
    `Resource`, the value handed to every Sink; `@isolatedScope`/`@scoped` wrap a
    method body in `Scope.isolated`/`Scope.inherit` under either decorator dialect
    (`agentic/rules/method-decorator-supports-both-dialects.md`, ADR-0006). `./serialization`'s
    `serializeError` is the one place a thrown value's whole `cause`/`errors` chain is walked into
    a `SerializedError`, the shape the logger and the error reporter share (ADR-0007); `Level`
    (`"trace"` through `"fatal"`) and `Threshold` (`Level | "off"`) are exported from the package
    root, not a sub-path, since every package that logs or reports needs them.
  - `packages/redaction` — `@vipengele/ts-core-redaction`: the reusable redaction library. A `RedactionPolicy` matches keys by exact string, regex or
    `{ segments }` (word-segment match), carves exceptions out with `except`, and composes through
    `composePolicies`; `secretKeys` is the frozen preset (ADR-0011). `redactUrl`,
    `redactQueryString` and `redactHeaders` redact secrets in transit — they read a URL or query
    string as text and a header list by name, always replace URL userinfo, and replace a matched
    header's whole value (ADR-0012).
  - `packages/observability` — `@vipengele/ts-core-observability`: the logger (`./logger`) and the
    error reporter (`./errors`), two entry points of one package. `./logger`'s `Logging` facade
    configures the default `LoggerProvider` through a layered builder or a spec string
    (`parseSpec`; a bad entry in a spec string is skipped with a warning, a bad level given in code
    throws `LoggingConfigError`); the level table and the default provider live in two
    `globalThis` slots (`vipengele.logger.levels`, `vipengele.logger.provider.v1`) so every
    resolved copy of the package agrees (ADR-0005), and a category with nothing configured
    resolves to `warn`. A `Logger`'s `trace`..`fatal` calls that pass the level check build a
    `LogRecord` (attributes normalized, errors through `serializeError`, both redacted with
    `secretKeys` unless the builder's `redaction` says otherwise) and write it with the Resource to
    every `Sink` the builder's `addSink` added, `clock` supplying `time`; a throwing sink goes to
    the provider's `onSinkError` and never reaches the caller (ADR-0007, ADR-0011). `./errors`'s `createReporter`
    builds a `Reporter` from a `ReporterBuilder`; `captureException`/`captureMessage` run every
    event through a five-stage pipeline (normalize, enrich, processors, filter, transport) and hand
    the survivor to a `Transport`, the fire-and-forget delivery contract (ADR-0010;
    `agentic/rules/transport-send-is-fire-and-forget.md`) every transport — the built-in
    `createConsoleTransport` and `createTestTransport` included — implements.
- `source/ts/` — `@vipengele/ts`, the framework's batteries-included umbrella package
  (`packages/ts/`, nested so `release.yml`'s publish-order globbing sees it). Its name is a
  deliberate exception to the `@vipengele/ts-<project>-<package>` convention (ADR-0003). It
  depends on `@vipengele/ts-core-common` and `@vipengele/ts-core-redaction` — a pin plus a
  `link:` override in its `pnpm-workspace.yaml` for each (ADR-0009) — and re-exports `Numeric`
  from `@vipengele/ts-core-common`'s `./types/numeric` sub-path, `Locale` (with `HourCycle`,
  `IsoWeekday`, `NameStyle`) from its `./locale` sub-path, `LocalDate`, `LocalTime`,
  `LocalDateTime`, `Instant`, `ZoneId` and `ZonedDateTime` (with their errors, guards,
  `ZoneResolutionError` and `DateSegment`, `DateSegmentType`, `DateTimeTryParseResult`,
  `Disambiguation`, `IsoDayOfWeek`, `ZonedDateTimeOptions`) from its `./types/date-time` sub-path, and `redact`,
  `secretKeys`, `composePolicies`, `redactUrl`, `redactQueryString` and `redactHeaders`, the value
  detectors `valueDetectors`, `jwt`, `bearerToken`, `creditCard`, `email`, `awsAccessKey`,
  `githubToken` and `stripeKey` (with `RedactionPolicy`, `KeyMatcher`, `Detector`, `RedactOptions`,
  `RedactStringOptions`, `Replacement`) from
  `@vipengele/ts-core-redaction`.
- A sub-path of `@vipengele/ts-core-common` needs both a `tsup.config.ts` entry and a
  `package.json` `exports` key; `src/package-exports.test.ts` fails when either is missing.
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
`window` or `process` exists. `@vipengele/ts-core-common/runtime` (`detectRuntime`,
`detectCapability`) is where that detection lives.

Shipped `src/` never imports a `node:` specifier outside `import type`: a Biome grit plugin
(`source/<project>/biome/no-node-imports.grit`, run by `pnpm lint` and checked against its
fixtures by `biome/check-node-import-ban.mjs`) rejects it, and a Node built-in is reached through
`process.getBuiltinModule("node:…")` (ADR-0004). Test files are exempt.

## Packages

ESM only, `"sideEffects": false`, `files: ["dist"]`, zero runtime dependencies outside the
framework unless a package says why. `@opentelemetry/api` is an optional peer where trace
correlation needs it — a consumer without OpenTelemetry pays nothing. A custom error extends
`VipengeleError` and ships with a `code` and a type-guard, never a bare class a caller checks with
`instanceof` (`agentic/rules/custom-errors-carry-a-code-and-a-type-guard.md`, ADR-0002).

## Workspace and dependency policy

- `@vipengele/*` packages publish to the public npm registry; installing and building need no token.
- A project's `pnpm-workspace.yaml` enforces `minimumReleaseAge`, `trustPolicy: no-downgrade`, and
  `blockExoticSubdeps: true` for supply-chain hygiene, plus `overrides` for specific
  provenance-driven pins (see the comments in that file before touching `overrides`).
- New dependencies with a postinstall script need an entry in the project's `pnpm-workspace.yaml`
  `allowBuilds`, or pnpm silently skips the script.

## CI

- `.github/actions/changed-projects` lists the `source/` projects a diff touches, then adds every
  project that depends on one of them, directly or transitively, through a cross-project
  dependency (ADR-0009). A change to a shared CI file (`ci-*.yml`, that action, `.lydite/`)
  selects every project; a change that touches no project (docs, agentic instructions) selects
  none and the stages skip.
- `verify-cross-project-deps` runs once per workflow, before project selection, and fails unless
  every cross-project pin has a matching `link:` override and vice versa (ADR-0009).
- `build-cross-project-deps` runs per affected project, right after its own `pnpm install
  --frozen-lockfile` and before its build, and builds the sibling projects it links to,
  dependencies first — install only records the `link:` override, so the linked `dist/` is only
  needed once the project builds. A project with no cross-project dependency is a no-op.
- `ci-build.yml` runs, per affected project, `pnpm lint`, `pnpm format:check`, `pnpm build`,
  `pnpm type-check`.
- `ci-test.yml` installs Chromium and runs `pnpm test` per affected project. The `lydite` stage
  gates coverage separately, running each `.lydite/components.yml` component's suite itself.

## Release

A release is one tag, `vX.Y.Z`, pushed by a human (ADR-0001). The `release` skill walks the whole
sequence.

- `release.yml`: `tag` validates the tag, requires `docs/release-notes/<tag>.md`, runs
  `verify-cross-project-deps` with `expect-version` set so every cross-project pin matches the
  tag, and computes the publish order; `build` is a credential-free matrix over every project that
  builds each project's cross-project dependencies first; `publish` holds the OIDC token, verifies
  the artefacts carry nothing but `dist/`, and publishes each project in dependency order with
  provenance; `announce` creates the GitHub Release. Publishing is idempotent.
- The `release` skill rewrites every cross-project pin to the new version and refreshes the
  depending project's lockfile before the release PR, so `verify-cross-project-deps` and
  `--frozen-lockfile` both pass in the release change (ADR-0009).
- A brand-new package name must be created by a one-time manual publish before a trusted publisher
  can be enrolled on it.
