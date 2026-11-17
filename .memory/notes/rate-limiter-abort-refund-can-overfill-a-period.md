---
name: rate-limiter-abort-refund-can-overfill-a-period
kind: rationale
description: The rate limiter keeps one signed permit balance with no per-waiter ledger, so an aborted waiter's refund can put more calls into one period than the limit; this is an accepted trade-off.
anchors:
  - path: source/core/packages/resilience/src/rate-limiter/rate-limiter.ts
    blob: b23ee9e2c843
confidence: verified
---

In `source/core/packages/resilience/src/rate-limiter/rate-limiter.ts` the limiter state is one
balance, `permits`: free permits net of every reservation, negative while waiters hold permits
not yet refilled (`:56-57`). It starts at `limitForPeriod`, not `burst` (`:164`). `admit`
computes the wait from the signed balance before reserving, so a refusal reserves nothing
(`:107-118`, `waitFor` at `:76-77`).

An aborted waiter returns its permits, capped at `burst` (`:131`), but the other sleepers keep
their due instants (`:123-125`). Aborting a waiter that is not the last one therefore lets a
later arrival be due in the same period as an existing sleeper. With limit 1 and burst 1: A runs
now, B is due at 100, C at 200; B aborts; D arrives and is due at 200 alongside C.

This is deliberate (resilience4j behaves the same). Fixing it needs rescheduling sleepers or a
per-period reservation ledger; do not "fix" it with a local tweak to the refund.
