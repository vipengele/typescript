---
description: A Transport's `send` returns at once, never throws, and is never awaited by the Reporter; batching, retry and drop decisions belong to the transport.
---

# A Transport's `send` returns at once and never throws

The Reporter never awaits `send` and never catches anything it throws — a throw would surface
inside the caller's own `catch` block, right where an exception was just being reported. Batching,
retry and the decision to drop an event belong entirely to the Transport, behind `send`'s
synchronous, non-throwing boundary. See ADR-0010 for the full contract, including `flush` and
`close`.

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

// ✗ async send(event) {
//   await deliver(event); // the pipeline never awaits this; a rejection here is unhandled,
//                         // and the caller's own catch block is the last place it can surface.
// }
```

A Transport that needs to await work — a network call, a queue flush — starts that work from
`send` without awaiting it there, and tracks it internally so `flush`/`close` can wait on it.
