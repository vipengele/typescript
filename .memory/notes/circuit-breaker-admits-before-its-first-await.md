---
name: circuit-breaker-admits-before-its-first-await
kind: invariant
description: The circuit breaker admits a call synchronously before execute's first await, drops stale outcomes by generation, and counts a throwing isFailure as a failure so a half-open permit is never leaked.
anchors:
  - path: source/core/packages/resilience/src/circuit-breaker/circuit-breaker.ts
    blob: 2224cd7d6477
confidence: verified
---

In `source/core/packages/resilience/src/circuit-breaker/circuit-breaker.ts`:

- `signal.throwIfAborted()` and `admit(breaker)` run before the first `await` (`:315-317`).
  Inserting an `await` ahead of `admit` lets a synchronous burst of calls overrun
  `permittedCallsInHalfOpen`; the half-open burst tests depend on the ordering.
- Every transition bumps `generation` (`:164`); `complete` drops an outcome admitted under an
  older generation (`:272-273`). It is recorded nowhere but still reaches the caller.
- `classify` wraps the user's `isFailure` in try/catch and returns `true` on a throw
  (`:259-265`). Without it, a throw in half-open skips recording the probe, the in-flight probe
  count is never decremented, and with no half-open wait limit the circuit refuses every call
  forever.
