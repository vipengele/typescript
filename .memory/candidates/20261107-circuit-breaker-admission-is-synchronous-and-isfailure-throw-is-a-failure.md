---
about: "the circuit breaker admits a call synchronously before execute's first await, drops stale outcomes by generation, and counts a throwing isFailure as a failure so a half-open permit is never leaked"
saw:
  - source/core/packages/resilience/src/circuit-breaker/circuit-breaker.ts
  - source/core/packages/resilience/src/circuit-breaker/circuit-breaker.test.ts
---
- `run()` in `circuit-breaker.ts` checks the pre-aborted signal and calls `admit()` (lazy transition via `settleElapsedWait`, `takeProbePermit`, generation capture) before its first `await`. The half-open burst tests in `circuit-breaker.test.ts` depend on this: inserting an `await` before `admit()` lets a synchronous burst overrun `permittedCallsInHalfOpen`.
- `transition()` bumps `generation`; `complete()` drops any outcome whose captured generation is not current, so it is recorded nowhere but still reaches the caller.
- `classify()` wraps the user `isFailure` in try/catch and returns `true` on a throw. Without it, a throw in half-open skips `recordProbe`, `inFlightProbes` is never decremented, and with `maxWaitInHalfOpenMs` unset the circuit refuses every call forever.
- The `state` and `metrics` getters never transition or emit; `stateAt()` is the pure read and `settleElapsedWait()` is the only place a delayed transition happens.
