# The batching sink wraps a Batch Sink, and its process-exit drain is opt-in

`./logger`'s `createBatchingSink` buffers Log Records and hands them on in batches to a
`BatchSink` — `writeBatch(entries)`, each entry a record with its own Resource, returning `void` or
a `Promise` — so a target that can send many records at once (an HTTP endpoint, a file append)
pays one call per batch. A plain `Sink` is accepted too, replayed one record at a time in order.
The wrapper returns `Sink & { flush; close }`, as `createOtlpLogSink` does; `Sink` and the provider
gain no lifecycle members, since the `(record, resource)` arity is the shared
`vipengele.logger.provider.v1` slot protocol (ADR-0005, ADR-0022).

One batch is in flight at a time and a returned `Promise` is awaited before the next. The wrapper
does not retry: retry belongs to the destination, as it does to a Transport (ADR-0010). A batch
whose `writeBatch` throws or rejects is dropped and reported, never surfaced to the logging call.

Page hide is watched by default through the delivery core's `watchUnload`, with `lifecycle: {}`
opting out, as the OTLP sink does. Page hide is the one exception to one batch in flight: it hands
the whole buffer to the destination at once without waiting for an outstanding batch, because a
hidden page may never run another task. Across that boundary an asynchronous destination may
receive batches out of order. The wrapper applies no byte budget on hide; a destination that sends
over the network owns its own keepalive budget. A process-exit drain is opt-in (`flushOnExit`): a Node `exit`
listener runs synchronously and cannot await anything, so it only completes for a synchronous
`writeBatch`, and an automatic listener on every wrapper would put a process listener the
application never asked for behind each sink. An application with an asynchronous destination
awaits `close()` itself, as ADR-0022 leaves to it.

## Considered Options

- **Reuse `createDelivery`.** It batches and drains, but it is bound to HTTP (`url`, `fetch`,
  `encode`) and has no "deliver this batch" seam; extracting one would widen a core two exporters
  share for a caller that does not need its retry or keepalive budget.
- **Wrap plain Sinks only.** Every batch would become N per-record calls, so batching would gain
  nothing but deferral.
- **Exit hook on by default.** Convenient, but asynchronous destinations get a drain that silently
  never completes, and it contradicts ADR-0022's choice to leave exit policy to the application.
