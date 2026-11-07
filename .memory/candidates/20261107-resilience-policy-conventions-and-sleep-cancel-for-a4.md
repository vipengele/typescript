---
about: "resilience policy conventions (A2/A3) and how to cancel a manual-time sleep without aborting the caller's signal"
saw:
  - source/core/packages/resilience/AGENTS.md
  - source/core/packages/resilience/src/circuit-breaker/circuit-breaker.ts
  - source/core/packages/resilience/src/circuit-breaker/config.ts
  - source/core/packages/resilience/src/timeout/timeout.ts
  - source/core/packages/resilience/src/retry/retry.ts
  - source/core/packages/resilience/src/listenable.ts
  - source/core/packages/common/src/testing/manual-time.ts
  - .lydite/components.yml
---

Found while planning A4 (RateLimiter, Bulkhead).

- Factory `createX(name, config, deps?)` returning `Policy & { events: Listenable<E> }`; `deps` = `{ clock?, scheduler? }` defaulting to `systemClock`/`systemScheduler`. Validation first, throwing `ResilienceConfigError`: `A <thing> needs a non-empty name`, or `<Thing> "<name>" expects <key> to be <constraint>, got <value>` (config.ts:`reject`; timeout.ts:`validate`). Durations capped at `MAX_TIMEOUT_DURATION_MS`.
- Events: `{ kind: "kebab-case", name, at: clock() }`, emitted after state mutation. Emitter swallows listener throws (listenable.ts).
- Abort: pre-aborted signal -> `signal.throwIfAborted()` before admission (rejects with signal.reason); no signal -> `new AbortController().signal`. Context `{attempt: 1, signal}`, built by the policy (the caller's signal passed through; timeout derives `AbortSignal.any`).
- Sleep cancellation: pass a private `AbortController` signal to `scheduler.sleep` and abort it (timeout.ts `finally { sleeper.abort(); }`). manual-time's onAbort splices the entry out and rejects with reason, so `pendingSleeps` drops; swallow the rejection (`.catch(noop)`). No caller-signal abort needed.
- manual-time: `advance` hops a real `setTimeout(0)` after each firing; a sleep registered after an `await` needs microtask flushing first (retry.test.ts `untilPending` loop over `pendingSleeps`). Nested `advance` throws TypeError.
- circuit breaker ignores RateLimitExceededError/BulkheadFullError/CircuitOpenError by guard (circuit-breaker.ts `isIgnored`); retry's default shouldRetry declines them. Both error classes live in errors/resilience-errors.ts and take `(message, details, options?)`: `RateLimitExceededError` exposes `limiter`, `permits`, `retryAfterMs`; `BulkheadFullError` exposes `bulkhead`, `reason` (`"full" | "wait-timeout"`). Guards and codes are unchanged.
- A3 (#181) description: ADRs and CONTEXT.md glossary are A7; release notes come with the release. Coverage: `core-resilience` is already a lydite component (.lydite/components.yml), no new entry needed.
- PR #181 review finding not visibly adopted: reset()/forceOpen() do not call settleElapsedWait first (event `from` can disagree with `state` getter).
