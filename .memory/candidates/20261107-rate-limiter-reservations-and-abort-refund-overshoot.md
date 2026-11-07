---
about: "rate limiter keeps one signed permit balance; an abort refund can put more calls in one period than burst"
saw:
  - source/core/packages/resilience/src/rate-limiter/rate-limiter.ts
---

- The limiter state is `{ start, cycle, permits }` (rate-limiter.ts `Limiter`). `permits` is free permits net of every reservation and goes negative while waiters hold permits not yet refilled; there is no per-waiter ledger.
- It starts with `limitForPeriod` permits, not `burst` (rate-limiter.ts `createLimiter`).
- `waitFor` computes the due instant from the signed balance: `start + (cycle + ceil((permits - balance) / limitForPeriod)) * refreshPeriodMs - now`. The wait is computed before reserving (`admit`), so a refusal reserves nothing.
- An aborted waiter refunds `min(burst, permits + p)` (`wait`), but sleepers keep their due instants. Aborting a waiter that is not the last lets a later arrival be due in the same period as an existing sleeper: with limit 1 / burst 1, A runs now, B due 100, C due 200; B aborts; D arrives and is due 200 alongside C. Accepted trade-off (as resilience4j); fixing it needs rescheduling sleepers or a per-period reservation ledger.
- The backward-clock test cannot use manual time (it never steps back); rate-limiter.test.ts uses a hand-stepped clock.
