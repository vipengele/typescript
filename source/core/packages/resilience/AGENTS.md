# @vipengele/ts-core-resilience

Resilience primitives. Entry points: `.` (re-exports `./errors`, `./retry` and `./timeout`),
`./errors`, `./retry` and `./timeout`. Run commands from `source/core` (`pnpm build`, `pnpm type-check`,
`pnpm test`, `pnpm lint`, `pnpm format:check`).

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

## Shared types and the emitter

- `src/types.ts` holds `Policy`, `ExecutionContext` (`attempt` is 1-based), `ExecuteOptions`
  (`signal` only), `Outcome<T>`, `Listenable<E>` and `Unsubscribe`; the package root exports them.
- `createEmitter` (`src/listenable.ts`) is internal and not exported from the root: policies own
  an emitter and expose only its `Listenable`. Each `on` is an independent subscription (the same
  function twice is called twice), `emit` walks a snapshot (a listener added mid-emit misses the
  event; one removed mid-emit still gets it), and a throwing listener is swallowed.

## Timeout (`src/timeout/timeout.ts`)

- `createTimeout(name, { durationMs }, { clock?, scheduler? })` returns a `TimeoutPolicy`: a
  `Policy` plus `events: Listenable<TimeoutEvent>`. `clock`/`scheduler` default to `systemClock`/
  `systemScheduler`; tests pass `createManualTime`'s pair. `./timeout` also re-exports the shared
  `Policy`, `ExecuteOptions`, `ExecutionContext`, `Listenable` and `Unsubscribe` types.
- Validation throws `ResilienceConfigError` for an empty name or a `durationMs` that is not finite,
  not above 0, or above `MAX_TIMEOUT_DURATION_MS` (2147483647, the `setTimeout` maximum; a larger
  delay overflows and fires almost at once).
- One attempt (`attempt: 1`) is raced against `scheduler.sleep(durationMs, sleeperSignal)`. The
  op's signal is `AbortSignal.any([callerSignal, timer.signal])`, never `AbortSignal.timeout`, so
  manual time drives it.
- Op settles first: the sleep is aborted (no pending sleep survives) and its rejection swallowed.
  Timer wins: `timer` aborts with an `OperationTimeoutError`, a `timeout` event (`at` from the
  clock) is emitted, and the policy rejects with that same error; the abandoned op's late
  rejection is observed so it is never unhandled.
- A pre-aborted caller signal rejects with its reason before `op` runs or a sleep starts; a
  synchronous throw from `op` rejects before a sleep starts. A mid-flight caller abort is not
  raced: it reaches `op` through its signal, and the op's own outcome decides the result.

## Retry (`src/retry/retry.ts`, `src/retry/backoff.ts`)

- `createRetry(name, { maxAttempts, backoff, shouldRetry?, retryAfter? }, { clock?, scheduler? })`
  returns a `RetryPolicy`: a `Policy` plus `events: Listenable<RetryEvent>`. `maxAttempts` is an
  integer of at least 1 and counts the first attempt. `./retry` re-exports the shared `Policy`,
  `ExecuteOptions`, `ExecutionContext`, `Listenable`, `Outcome` and `Unsubscribe` types.
- Retry calls `op({ attempt, signal })` itself, `attempt` 1-based; `signal` is the caller's, or a
  never-aborted signal when none is given. A synchronous throw counts as a failed attempt. The
  final error is rethrown as the very value `op` threw; a final `ok` outcome resolves with its
  value.
- Backoff strategies map the 1-based number of the attempt that just failed to a delay:
  `fixedBackoff(ms)`, `exponentialBackoff({ initialMs, multiplier = 2, maxMs? })`
  (`min(maxMs, initialMs * multiplier ** (attempt - 1))`) and `withJitter(strategy, "full" |
  "equal", random = Math.random)`. Each factory validates at creation and throws
  `ResilienceConfigError` for a non-finite or negative number, a `multiplier` below 1, or an
  unknown jitter kind, so the error surfaces where the bad number is written.
- `retryAfter(outcome, attempt)` overrides the backoff; `undefined` falls back to it. Every delay
  is sanitised before the sleep: NaN or negative becomes 0, and anything above 2147483647 is
  clamped to it. Without the clamp an infinite delay makes the scheduler reject with a
  `RangeError` in place of the operation's error, and an oversized one fires at once.
- The default `shouldRetry` declines `ok` outcomes and a `CircuitOpenError`,
  `RateLimitExceededError` or `BulkheadFullError` (matched by guard), and retries every other
  error, `OperationTimeoutError` included. It has no abort branch: the loop handles abort. A
  custom `shouldRetry` may retry an `ok` outcome; when attempts run out the last value is returned.
- Abort: the caller's signal is checked before the first attempt, after each failed attempt
  (before `shouldRetry` is asked) and is passed to `scheduler.sleep`; each rejects with
  `signal.reason`. An attempt that succeeds after an abort still returns its value.
- Events carry `kind`, `name` and `at` (the clock). `retry` (`attempt`, `delayMs`, `outcome`) is
  emitted before each sleep with the sanitised delay; `retry-exhausted` (`attempts`, `outcome`)
  only when `shouldRetry` wanted another attempt and none was left. A stop because `shouldRetry`
  declined emits nothing.
- The loop is split into small helpers (`attemptOnce`, `delayFor`, `sanitizeDelay`, `settle`)
  to keep each function's cyclomatic complexity well under lydite's CRAP gate of 30.
