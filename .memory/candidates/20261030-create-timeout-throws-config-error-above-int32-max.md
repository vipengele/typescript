---
about: "createTimeout throws ResilienceConfigError for durationMs above MAX_TIMEOUT_DURATION_MS (2^31-1), so a caller that must never reject validates the duration at construction"
saw:
  - source/core/packages/resilience/src/timeout/timeout.ts
  - source/core/packages/resilience/src/timeout/timeout.test.ts
  - source/core/packages/observability/src/errors/transports/http/options.ts
---
`createTimeout(name, { durationMs })` (timeout/timeout.ts) validates synchronously and throws `ResilienceConfigError` for a duration over `MAX_TIMEOUT_DURATION_MS` (exported from `./timeout`; timeout.test.ts:333-350), the setTimeout int32 ceiling. The HTTP transport builds a timeout per attempt inside `sendBatch`, which must never reject, so `resolveOptions` (http/options.ts) rejects a `requestTimeoutMs` above that bound with `HttpTransportConfigError` when the transport is created. Any other consumer that builds a timeout lazily from a user value needs the same up-front check.
