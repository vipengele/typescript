---
about: "createRetry has no exhaustion error: once maxAttempts is used it rethrows the last attempt's error as the same object"
saw:
  - source/core/packages/resilience/src/retry/retry.test.ts
  - source/core/packages/observability/src/errors/transports/http/request.ts
---
retry.test.ts:119 ("rethrows the last error as the same object once maxAttempts is used") pins it. A caller that needs to tell "attempts ran out" from "a non-retryable failure" must do it itself: the HTTP transport's `deliver` (http/request.ts) returns rejected statuses as values rather than throwing, so any rejection out of `policy.execute` means retries exhausted (or aborted, read from the signal).
