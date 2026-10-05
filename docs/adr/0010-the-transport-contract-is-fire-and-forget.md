# The Transport contract is fire-and-forget; durable delivery belongs to the HTTP transport

A Transport is three methods:

```ts
import type { Resource } from "@vipengele/ts-core-common/scope";

interface Transport {
  send(event: ErrorEvent, resource: Resource): void;
  flush(timeoutMs?: number): Promise<boolean>;
  close(timeoutMs?: number): Promise<boolean>;
}
```

`send` accepts an Error Event and the Resource it is sent with, and returns at once. It never throws
and the Reporter never awaits it: batching, retry and the decision to drop are the Transport's (CONTEXT.md). `flush` resolves `true`
once everything accepted so far has been delivered or dropped, `false` when the timeout elapses
first. `close` flushes, then turns every later `send` into a no-op.

The pipeline reads `Scope.resource()` once per event, at delivery, and passes the frozen result as
`resource`, so a Resource supplied through `Scope.setResource` after the Reporter was built is the
one a Transport sees. The Transport attaches it once per payload; the event itself never carries
it. The read runs inside a guard: a throw yields a Resource whose four keys are all `undefined`,
and the event still goes out. This differs from the logger, which drops the record when reading
the Resource throws: an Error Event is worth more than its Resource, so it is delivered without
one rather than lost. The console transport does not print the Resource; the test
transport records it in `resources`, parallel to `events`.

Delivery on page unload and the offline queue are options of the HTTP JSON Transport, not a wrapper
around an arbitrary Transport. On `pagehide`, or `visibilitychange` to `hidden`, it drains its batch
through `fetch` with `keepalive`, or `navigator.sendBeacon` where `keepalive` is unavailable. A batch
that fails for want of a network, or exhausts its retries, is written to an IndexedDB queue that is
replayed when the Transport is created and on the `online` event. The queue is bounded by entry count
and by bytes; once full it keeps what it holds and drops what arrives. The first error of an outage
is usually its cause, and the ones after it its echoes.

## Considered options

- **`send` returns a promise per event.** The Reporter would have to track every in-flight promise
  to know when it may exit, and an unload handler cannot await anything.
- **A Transport reads `Scope.resource()` itself.** Each Transport would repeat the read and its
  guard, and a throw in one of them would surface inside the caller's `catch` block. The pipeline
  reads it once and passes it.
- **`send` takes a batch.** Batching would move into the Reporter, but it is the Transport's job:
  only the Transport knows its payload limits, such as the 64 KiB a `keepalive` request may carry.
- **A generic offline decorator, `withOfflineQueue(transport)`.** A fire-and-forget `send` never
  tells a wrapper that delivery failed, so the decorator would need an outcome channel added to the
  contract for this one consumer. Unload delivery would still be HTTP-specific: a beacon needs an
  endpoint and a body format that only the HTTP Transport knows.
- **A public request-layer seam that offline and unload wrappers plug into.** This is the most
  composable, but it adds a second public extension point beside Transport for two behaviours that
  only HTTP delivery has.
- **Keep the newest entries once the queue is full.** A ring buffer evicts the root cause of an
  outage first.
