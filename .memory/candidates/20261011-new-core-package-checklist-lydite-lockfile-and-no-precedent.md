---
about: a new source/core package needs hand-written lydite depends_on/setup, a lockfile importer entry, tsup-then-tsc scripts, and a manual first publish; there is no Listenable, abstract-error, name-setting or resilience precedent
saw:
  - .lydite/components.yml
  - source/core/turbo.json
  - source/core/vitest.shared.ts
  - source/core/pnpm-lock.yaml
  - source/core/packages/observability/package.json
  - source/core/packages/redaction/package.json
  - source/core/packages/common/src/types/date-time/errors.ts
  - source/core/packages/common/src/errors/vipengele-error.ts
  - .github/workflows/release.yml
  - source/core/packages/resilience/src/errors/resilience-errors.ts
  - source/core/packages/resilience/src/timeout/timeout.ts
---
Re-checked by reading the files (not stale-note verdicts; see the two verdict candidates).

- lydite: every package has its own component (`.lydite/components.yml`); a package with sibling deps needs hand-written `depends_on` plus one `pnpm --filter <dep> run build` setup line per dep (observability block). Packages without deps need only name/dir/runner.
- Coverage: `vitest.shared.ts` gates 100% statements/branches/functions/lines over `src/**/*.ts` minus `*.test.ts`, union of node + chromium projects. A new package's `vitest.config.ts` is one line: `export { default } from "../../vitest.shared";`.
- Per-package files copied from redaction/observability: package.json (build `tsup && tsc -p tsconfig.build.json`, publishConfig access public + provenance, files dist+README, engines node>=24), tsup.config.ts, tsconfig.json, tsconfig.build.json, vitest.config.ts, README, LICENSE. turbo needs no edit (`^build` on build/type-check/test is global).
- Intra-project dep: observability uses `"@vipengele/ts-core-common": "workspace:*"` (package.json:56-57); `source/core/pnpm-lock.yaml` has an importers entry per package (`packages/observability` lists `link:../common`), so adding a package or dep changes the lockfile and `--frozen-lockfile` fails until it is refreshed.
- release.yml globs `source/*/packages/*/package.json` (line ~108), so `packages/resilience` is picked up with no edit; order is by project, not package. Header comment (lines 25-28) says a brand-new package name needs a one-time manual publish before a trusted publisher can be enrolled.
- Errors: `ResilienceError` (packages/resilience/src/errors/resilience-errors.ts) is the one abstract intermediate subclass of `VipengeleError`; common's concrete errors extend `VipengeleError` directly with a non-exported module-level code constant (date-time/errors.ts:1-50), while resilience exports each `*_ERROR_CODE`. Guards are `value instanceof Error && code === CONST`; `isResilienceError` matches the `resilience.` prefix instead. No error sets `name`.
- `Listenable` and its emitter live only in packages/resilience/src (types.ts, listenable.ts); the emitter is internal and not exported from the package root.
- Timeout and retry live in packages/resilience/src/timeout and src/retry; no ADR covers them. The only other timeout default is DEFAULT_FLUSH_TIMEOUT_MS in global-handlers.ts.
- Unhandled rejections: no vitest setup file/`dangerouslyIgnoreUnhandledErrors` in vitest.shared.ts, so vitest's default applies (reports unhandled errors, fails the run). emit.test.ts:721 attaches `.catch(() => {})` to a rejected promise "so that the runner does not report it as unhandled".
- `AbortSignal.any` is used by packages/resilience/src/timeout/timeout.ts (attemptSignal) with no feature check; tsconfig lib is ES2022 + DOM.
