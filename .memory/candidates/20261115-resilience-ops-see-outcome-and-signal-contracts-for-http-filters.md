---
about: "what a resilience op sees (signal, attempt) differs per policy, retry/breaker take an Outcome so an ok 503 Response can be retried or counted, and abort never races mid-flight"
saw:
  - source/core/packages/resilience/src/types.ts
  - source/core/packages/resilience/src/retry/retry.ts
  - source/core/packages/resilience/src/timeout/timeout.ts
  - source/core/packages/resilience/src/circuit-breaker/circuit-breaker.ts
  - source/core/packages/resilience/src/rate-limiter/rate-limiter.ts
  - source/core/packages/resilience/src/bulkhead/bulkhead.ts
---
Read directly, all verified in this checkout. Line numbers are approximate. `RetryPolicy.execute` also takes per-call `shouldRetry`/`retryAfter` (`RetryExecuteOptions`) and `CircuitBreakerPolicy.execute` a per-call `isFailure` (`CircuitBreakerExecuteOptions`), which replace the configured ones for that call; a per-call `retryAfter` returning `undefined` falls back to backoff, never to the configured `retryAfter`.

- `Outcome<T> = {ok:true,value}|{ok:false,error}` exists (types.ts:14). `retry.shouldRetry(outcome, attempt)` and `retryAfter(outcome, attempt)` (retry.ts:150,155) and breaker `isFailure(outcome)` (circuit-breaker.ts:94) all see it, so a successful 503 `Response` can be retried/counted as failure with `outcome.ok && outcome.value.status >= 500`. Default shouldRetry never retries an ok outcome (retry.ts:218-224). On exhaustion with an ok outcome retry returns the value (settle, retry.ts:252-257,276), it does not throw; an error outcome rethrows the very value thrown.
- Default retry also retries any error except CircuitOpen/RateLimitExceeded/BulkheadFull (retry.ts:223), so an http filter must veto HttpConfigError itself (a one-shot body re-send raises one).
- ctx per policy: only retry gives a real `attempt` (retry.ts:267); breaker, limiter, bulkhead, timeout hard-code `attempt: 1` (circuit-breaker.ts:295, rate-limiter.ts:148, bulkhead.ts:151, timeout.ts:88). Retry/breaker/limiter/bulkhead pass the caller's signal object through unchanged (a fresh never-aborting one when absent); only timeout derives `AbortSignal.any([caller, timer])` (timeout.ts:61-63).
- Abort: every policy does `signal.throwIfAborted()` before admission. Mid-flight caller abort is NOT raced by timeout (timeout.ts:74-77) or bulkhead (permit held until op settles, bulkhead.ts:139-143): the op must honour ctx.signal itself (fetch does). Retry checks the signal after a failed attempt only (retry.ts:268-270) and aborts the inter-attempt sleep.
- Timeout late op: the op promise is raced against a scheduler sleep; on expiry `timer.abort(OperationTimeoutError)` then rejects with the same error; `pending.catch(noop)` swallows a later rejection, a later resolve is discarded, and the sleep is aborted in `finally` so no timer lingers (timeout.ts:86-101).
- Breaker: admission is synchronous (all before the first await, circuit-breaker.ts:287-298); a throwing `isFailure` counts as failure and never replaces the op's value/error (:238-248); an outcome is ignored (not recorded) when `signal.aborted` at completion or the error is a refusal from another policy (:199-206). Consequence for ordering: with timeout INSIDE the breaker the breaker's own signal is not the timer's, so a timeout counts as a failure; with timeout outside, it would be ignored.
- Rate limiter: admit reserves synchronously, refusal reserves nothing; abort during the wait refunds `min(burst, permits+1)` and rethrows signal.reason (rate-limiter.ts:107-135). Bulkhead `leave` is a no-op when the waiter already left (bulkhead.ts:74-83); `release` hands the permit to the queue head (:128-136).
