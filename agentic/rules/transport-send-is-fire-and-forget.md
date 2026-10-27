---
description: A Transport's `send` returns at once, never throws, and is never awaited by the Reporter; batching, retry and delivery drops belong to the transport, policy drops to the Reporter.
---

# A Transport's `send` returns at once and never throws

The Reporter never awaits `send` and never catches anything it throws — a throw would surface
inside the caller's own `catch` block, right where an exception was just being reported. Batching,
retry and the delivery drop — an event the Transport cannot deliver, such as one arriving at a full
queue or one whose retries are exhausted — belong entirely to the Transport, behind `send`'s
synchronous, non-throwing boundary. Whether an event should be reported at all (sampling, ignored
errors, processors, deduplication, the rate limit) is the Reporter's policy drop, settled before
`send` is called; a Transport does not repeat it. `send(event, resource)` takes the Resource the
pipeline read for that event as its second argument, for the Transport to attach to its payload. See
ADR-0010 for the full contract, including `flush` and `close`, and ADR-0020 for the split between
policy and delivery drops.

## Applies to

Any implementation of `Transport` in `@vipengele/ts-core-observability`'s `./errors` entry point
(`source/core/packages/observability/src/errors/transport.ts`), including the built-in
`createConsoleTransport` and `createTestTransport` and any transport added after them.

## Example

```ts
// ✓ source/core/packages/observability/src/errors/transports/console-transport.ts
send(event) {
  if (closed) {
    return;
  }
  target[methodFor(event.level)](event);
},

// ✓ source/core/packages/observability/src/errors/transports/test-transport.ts
send(event, resource) {
  if (closed) {
    return;
  }
  events.push(event);
  resources.push(resource);
},

// ✗ async send(event, resource) {
//   await deliver(event, resource); // the pipeline never awaits this; a rejection here is
//                                   // unhandled, and the caller's own catch block is the last
//                                   // place it can surface.
// }
```

A Transport that needs to await work — a network call, a queue flush — starts that work from
`send` without awaiting it there, and tracks it internally so `flush`/`close` can wait on it.
