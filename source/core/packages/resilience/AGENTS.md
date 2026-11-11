# @vipengele/ts-core-resilience

Resilience primitives. Entry points: `.` (re-exports `./bulkhead`, `./circuit-breaker`, `./compose`, `./errors`,
`./rate-limiter`, `./registry`, `./retry` and `./timeout`), `./bulkhead`, `./circuit-breaker`, `./compose`,
`./errors`, `./rate-limiter`, `./registry`, `./retry` and `./timeout`. Run commands from `source/core` (`pnpm build`, `pnpm type-check`,
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
- `ResilienceConfigError` takes `(message, options?: ErrorOptions)`. `CircuitOpenError`,
  `RateLimitExceededError` and `BulkheadFullError` take `(message, details, options?)` and expose the
  fields of `details` (`circuit`, `state`, `remainingMs`; `limiter`, `permits`, `retryAfterMs`;
  `bulkhead`, `reason`), named so as not to clash with `Error#name`. `OperationTimeoutError` takes
  `(message, durationMs, options?)` and exposes `durationMs`. No error sets `name`, so it reads
  "Error".

## Package layout

- `tsup.config.ts` has one entry per export and `package-exports.test.ts` fails when an `exports`
  key and a tsup entry disagree.
- `src/circuit-breaker/` holds `circuit-breaker.ts` (the policy and state machine), `config.ts`
  (config types and validation) and `sliding-window.ts`; the window and the validator are internal and
  not exported from the barrel.
- `src/rate-limiter/` and `src/bulkhead/` each hold the policy (`rate-limiter.ts`, `bulkhead.ts`) and
  its `config.ts` (config and deps types, validation).
- `src/compose/` holds `compose.ts` (`compose`, standalone: it does not import the registry).
  `src/registry/` holds `registry.ts` (`createRegistry`, the instance store and `pipeline`),
  `builder.ts` (`RegistryBuilder`, snapshotted when `build` returns), `policy-table.ts` (the one
  factory table typed `satisfies { [K in PolicyKind]: ... }`), `defaults.ts` (`builtInDefaults`),
  `default-registry.ts` (`defaultRegistry`, state only in the `Symbol.for` slot on `globalThis`) and
  `types.ts`. ADR-0029 records the decisions.
- `src/config-validation.ts` is internal and not exported: the shared `reject(label, name, key,
  constraint, value)` that throws `ResilienceConfigError`, `isIntegerAtLeastOne`, `isDuration` and
  `DURATION_CONSTRAINT`.
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

## Circuit breaker (`src/circuit-breaker/`)

- `createCircuitBreaker(name, config, { clock? })` returns a `CircuitBreakerPolicy`: a `Policy` plus
  `events: Listenable<CircuitBreakerEvent>`, a `state` getter, a `metrics` getter, `reset()` and
  `forceOpen()`. There is no scheduler: the breaker never sleeps. `op` runs once with `attempt: 1`.
  Helpers stay small to keep each function under lydite's CRAP gate of 30.
- `validateCircuitBreakerConfig` (`config.ts`) throws `ResilienceConfigError` at creation, with
  `Circuit breaker "<name>" expects <key> to be <constraint>, got <value>`, or `A circuit breaker needs
  a non-empty name`. `failureRateThreshold` is finite in (0, 100]; `minimumCalls` and
  `permittedCallsInHalfOpen` are integers of at least 1 for both window types; `slidingWindow.type`
  is `"count"` or `"time"`; a count `size` is an integer of at least 1; a time `size` (ms) and the two
  waits are finite, above 0 and at most `MAX_TIMEOUT_DURATION_MS`. A count window with `minimumCalls >
  size` is rejected, never clamped.
- Count windows are a ring of the last `size` outcomes. Time windows are aggregated buckets of
  `max(1, ceil(size / 100))` ms (about 100), evicted lazily against the clock on every record and
  read, so memory is bounded whatever the throughput and the edge is accurate to one bucket. A clock
  reading earlier than the newest bucket lands in it and evicts nothing.
- Classification is three-way. A call is ignored when the caller's signal is aborted at completion or
  the error is a `RateLimitExceededError`, `BulkheadFullError` or `CircuitOpenError` (by guard). An
  ignored call is not recorded, releases its half-open permit and increments `ignoredCalls`.
  Otherwise `isFailure(outcome)` decides, default `!outcome.ok`; a custom one sees `ok: true`
  outcomes. An `isFailure` that throws classifies the outcome as a failure, and the caller still gets
  the op's own value or error. A synchronous throw from `op` is an `ok: false` outcome. A pre-aborted
  caller signal rejects with its reason before admission and is not counted.
- Every transition increments a generation and each admitted call captures it. An outcome whose
  generation is not current is recorded nowhere, though its value or error still reaches the caller.
- Closed: after recording, the circuit opens (`failure-rate`) when buffered calls reach
  `minimumCalls` and the failure rate is at or above the threshold.
- open to half-open is lazy: no timer. The `state` getter is pure: it reports `"half-open"` once
  `waitDurationInOpenMs` has elapsed and `"open"` once a half-open circuit is past
  `maxWaitInHalfOpenMs`, but mutates nothing and emits nothing. The transition and its event happen
  on the next `execute`, and after the open wait that call is the first probe. A read (`state`,
  `metrics`) never transitions and never emits; time-bucket eviction on read is the one allowed
  housekeeping. Between the wait elapsing and the next call, `state` reads `"half-open"` while
  `metrics` still holds the open period's counters. Elapsed time is `max(0, now - enteredAt)`, so a
  clock stepping back never gives a negative `remainingMs`.
- Half-open admits up to `permittedCallsInHalfOpen` calls, counting in-flight ones, and refuses the
  rest with state `"half-open"`. When that many non-ignored probes have recorded, the failure rate
  over just those decides: below the threshold closes with a fresh window (`half-open-passed`), at
  or above opens for another full wait (`half-open-failed`). `minimumCalls` does not apply.
  Admission is synchronous: the state read, lazy transition, permit take and generation capture all
  happen inside `execute` before its first `await`, which a synchronous burst depends on.
- `maxWaitInHalfOpenMs` is measured from entering half-open. The first `execute` after the deadline
  transitions to open (`half-open-timed-out`, new wait starting then) and is itself refused;
  outstanding probes are stale by generation. Unset waits indefinitely.
- `forceOpen()` moves to `"forced-open"` (`forced-open`), refusing every call until `reset()`, and is
  a no-op while forced-open. `reset()` from any state moves to closed with a fresh window, counters
  and generation, and emits `reset` only when the state actually changes; in closed it still clears
  the window and counters and makes in-flight outcomes stale, with no event.
- `metrics` is a frozen snapshot per read: `failureRate`, `bufferedCalls`, `failedCalls`,
  `successfulCalls`, `notPermittedCalls`, `ignoredCalls`. `failureRate` (0 to 100) is `undefined`
  below `minimumCalls` while closed, until all permitted probes have recorded while half-open, and
  always while open or forced-open. Every counter resets on every state transition, `reset()` and
  `forceOpen()` included.
- Events carry `kind`, `name` and `at`, and are emitted after the state mutation.
  `circuit-state-changed` has `from`, `to` and a `reason` (`failure-rate`, `wait-elapsed`,
  `half-open-passed`, `half-open-failed`, `half-open-timed-out`, `reset`, `forced-open`);
  `circuit-call-not-permitted` has the refusing `state`. There is no per-call success or failure
  event.
- Refusals are `CircuitOpenError`s with message `Circuit breaker "<name>" is <state> and refused the
  call`, and `circuit`, `state` and `remainingMs`. `remainingMs` is set only for `"open"`, the time
  until half-open, never below 0.

## Rate limiter (`src/rate-limiter/`)

- `createRateLimiter(name, { limitForPeriod, refreshPeriodMs, maxWaitMs, burst? }, { clock?, scheduler? })`
  returns a `RateLimiterPolicy`: a `Policy` plus `events: Listenable<RateLimiterEvent>` and
  `tryAcquire(permits = 1)`. `op` runs once with `attempt: 1`.
- Ranges: `limitForPeriod` an integer of at least 1; `refreshPeriodMs` finite, above 0 and at most
  `MAX_TIMEOUT_DURATION_MS`; `burst` an integer of at least `limitForPeriod`, default `limitForPeriod`;
  `maxWaitMs` required, finite, at least 0 and at most `MAX_TIMEOUT_DURATION_MS`, `0` meaning fail fast.
- The limiter starts with `limitForPeriod` permits. Refill is discrete, counted in whole periods from
  creation on the injected clock: the cycle index is `max(lastCycle, floor((now - start) /
  refreshPeriodMs))`, so it never goes back. A backward clock step adds nothing and the forward step
  after it does not refill twice. Each passed period adds `limitForPeriod`, capped at `burst`; with no
  `burst` that is resilience4j's per-cycle reset.
- The wait is computed before reserving. Beyond `maxWaitMs` the call rejects at once with a
  `RateLimitExceededError` carrying `retryAfterMs`, reserving nothing and sleeping not at all. Within
  it, the call reserves (the balance goes negative) and sleeps with the caller's signal. Calls are
  served in arrival order, and `tryAcquire` never overtakes a reservation.
- An abort refunds the permits, capped at `burst`, and rejects with `signal.reason`. Sleepers keep their
  due instants, so a refund benefits later arrivals only. This is an accepted trade-off, as in
  resilience4j, and can briefly put more calls in one period than `burst`.
- `execute` takes 1 permit. `tryAcquire(permits = 1)` throws `RangeError` for a non-integer or a value
  below 1, returns `false` for more than `burst`, and emits nothing.
- Events carry `kind`, `name` and `at`. `rate-limit-exceeded` has `permits` and `retryAfterMs`;
  `rate-limit-waited` has `permits` and `waitMs`, the planned wait.

## Bulkhead (`src/bulkhead/`)

- `createBulkhead(name, { maxConcurrent, maxQueue?, maxWaitMs? }, { clock?, scheduler? })` returns a
  `BulkheadPolicy`: a `Policy` plus `events: Listenable<BulkheadEvent>` and an `available` getter,
  `maxConcurrent - running`. `op` runs once with `attempt: 1`.
- `maxConcurrent` is an integer of at least 1; `maxQueue` an integer of at least 0, default 0;
  `maxWaitMs` finite, above 0 and at most `MAX_TIMEOUT_DURATION_MS`, and rejected when `maxQueue` is 0
  (fail fast is `maxQueue: 0`). Without `maxWaitMs` a queued call waits until it gets a permit or aborts.
- A running caller's permit is released only when `op` settles (resolve, reject or synchronous
  throw). An abort does not release it, so `maxConcurrent` is a true limit; the bulkhead never aborts a
  signal.
- A queued caller whose signal aborts leaves the queue and rejects with `signal.reason`, emitting no
  event. `maxWaitMs` elapsing rejects with `BulkheadFullError` reason `"wait-timeout"`. A call finding
  no permit and no queue place rejects with reason `"full"`.
- A released permit is handed to the oldest waiter (FIFO) without changing `running`.
- Each queue entry's wait sleep has its own `AbortController`. It is aborted (the rejection swallowed)
  and the caller-signal listener removed when the entry is granted or leaves the queue.
- Event `bulkhead-rejected` carries `kind`, `name`, `at` and `reason`.
