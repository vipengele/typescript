# @vipengele/ts-core-resilience

Resilience primitives. Entry points: `.` (re-exports `./errors`) and `./errors`. Run commands from
`source/core` (`pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm lint`, `pnpm format:check`).

## Errors (`src/errors/resilience-errors.ts`)

- `ResilienceError` is an abstract class extending `VipengeleError`; it adds nothing but the
  grouping. Each concrete error (`CircuitOpenError`, `RateLimitExceededError`, `BulkheadFullError`,
  `OperationTimeoutError`, `ResilienceConfigError`) fixes `code` to an exported `*_ERROR_CODE`
  constant, all of the form `resilience.<kind>`.
- Every concrete guard is `value instanceof Error && code === CODE`, anchored to `Error` and never
  to a package class (ADR-0002). `isResilienceError` instead matches any string `code` starting
  with `resilience.`, so a plain `Error` carrying such a code passes.
- A test asserts every exported `*_CODE` constant starts with `resilience.`; a code outside the
  prefix would be missed by `isResilienceError`.
- Constructors take `(message, options?: ErrorOptions)`. `OperationTimeoutError` takes
  `(message, durationMs, options?)` and exposes `durationMs`. No error sets `name`.

## Package layout

- `tsup.config.ts` has one entry per export and `package-exports.test.ts` fails when an `exports`
  key and a tsup entry disagree.
- The only dependency is `@vipengele/ts-core-common`, resolved through its built `dist/`, so it is
  built before this package's tests run (turbo's `^build`; the lydite setup line in
  `.lydite/components.yml`).
