---
about: "every resilience policy except retry builds its own ctx {attempt: 1, signal}, so compose/pipeline must re-thread the outer attempt and signal by hand; ADR-0029 decision 6 records how"
saw:
  - source/core/packages/resilience/src/compose/compose.ts
  - docs/adr/0029-resilience-registry-and-composition.md
  - source/core/packages/resilience/src/types.ts
  - source/core/packages/resilience/src/retry/retry.ts
  - source/core/packages/resilience/src/timeout/timeout.ts
  - source/core/packages/resilience/src/bulkhead/bulkhead.ts
  - source/core/packages/resilience/src/rate-limiter/rate-limiter.ts
  - source/core/packages/resilience/src/circuit-breaker/circuit-breaker.ts
---
Read while planning A5 (ResilienceRegistry / compose / pipeline). `Policy.execute(op, {signal?})` (types.ts) gives an inner policy no way to receive an attempt number.
- retry.ts `run`: `op({ attempt, signal })`, attempt increments, signal is the caller's (or a fresh never-aborted one).
- timeout.ts `runAttempt`: `op({ attempt: 1, signal: AbortSignal.any([caller, timer]) })`.
- bulkhead.ts:151, rate-limiter.ts:148, circuit-breaker.ts:295: all `{ attempt: 1, signal }` (caller's signal passed through).
So naive nesting `retry.execute(() => cb.execute(op))` loses attempt (op sees 1 on every retry) and the outer signal unless the adapter forwards it: `outer.execute(c1 => inner.execute(c2 => op({ attempt: c1.attempt, signal: c2.signal }), { signal: c1.signal }))`. Passing `c1.signal` as inner options makes c2.signal derive from it (timeout adds its timer; others pass through), so the op sees the innermost signal.
Interactions that the fixed order retry > cb > rl > timeout > bulkhead relies on:
- cb `isIgnored` (circuit-breaker.ts:199) ignores an outcome when ITS signal is aborted, or the error is CircuitOpen/RateLimitExceeded/BulkheadFull. Timeout sits inside cb and aborts only its own timer, so cb sees an unaborted signal + OperationTimeoutError and counts a failure (desired). A timeout OUTSIDE cb would abort cb's signal and cb would ignore the timeout.
- retry default shouldRetry (retry.ts `defaultShouldRetry`) declines CircuitOpen/RateLimitExceeded/BulkheadFull but retries OperationTimeoutError; retry rethrows the last error as the same object.
- retry aborts: `signal.throwIfAborted()` after each failed attempt and sleeps on the caller's signal.
- bulkhead innermost: a timeout abort while queued leaves the queue with signal.reason; a granted waiter whose signal aborts still runs op and holds the permit until it settles (see candidate 20261107-bulkhead-leave-is-idempotent...).
`src/compose/compose.ts` `runLayer` does this re-threading, and `src/compose/compose.test.ts` covers retry > breaker attempts, nested retries (1, 2, 2, 3), abort propagation and timeout-inside-breaker; ADR-0029 decisions 6 and 7 record the rule and the fixed order.
