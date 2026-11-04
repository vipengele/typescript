---
about: "an untimed createHttpTransport flush() never resolves when the flush itself starts a batch that drops synchronously (serialize throws, or no fetch)"
saw:
  - source/core/packages/observability/src/errors/transports/http-transport.ts
---
`flushAccepted` (http-transport.ts) calls `startSending()` before it registers its `FlushWaiter`. If the batch that start
sends settles synchronously as a drop (`serialize` throws → `"unsendable"`, or `globalThis.fetch` is absent), `settle()`
runs while `waiters` is empty, so the waiter registered next waits for a `settled` count already reached, and with no
timeout it never resolves. Independent of `offline`. Tests avoid it by letting the linger timer start the batch before
flushing. Registering the waiter before `startSending()` is the likely fix.
