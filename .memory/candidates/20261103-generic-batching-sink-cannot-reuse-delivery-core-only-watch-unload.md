---
about: "delivery core is fetch/HTTP-bound (encode -> POST), so a generic batching sink wrapper can reuse only watchUnload/detectLifecycleTargets and the Scheduler pattern, not createDelivery"
saw:
  - source/core/packages/observability/src/delivery/delivery.ts
  - source/core/packages/observability/src/delivery/unload.ts
  - source/core/packages/observability/src/logger/otlp-sink.ts
  - source/core/packages/observability/src/logger/record.ts
  - docs/adr/0022-otlp-export-shares-one-delivery-core.md
  - docs/adr/0022-http-json-transport-delivery.md
  - docs/adr/0012-global-handlers-are-an-integration-with-a-required-exit-policy.md
---
Found while planning issue #34 (batching sink wrapper).

- `createDelivery` takes `url`/`fetch`/`encode` and its unload drain is a single `keepalive` fetch
  limited to 64 KiB (ADR-0022 otlp "Unload sends one keepalive request"); it has no pluggable
  "deliver batch" step, so wrapping an arbitrary inner Sink through it would mean extracting a new seam.
  `delivery/` must stay free of `LogRecord` and `./logger` imports (observability AGENTS.md).
- Reusable pieces: `detectLifecycleTargets` / `watchUnload` (`delivery/unload.ts`, returns an unwatch
  function; `visibilitychange` counts only when `visibilityState === "hidden"`, both events usually
  fire so the handler must be idempotent), and the injected-`Scheduler` timer pattern
  (`delivery.ts:353`, `scheduler.sleep(ms, signal).then(...)`, no `unref`).
- No shipped code registers a Node exit hook for logs/transport: ADR-0022 (both) say hooks are
  synchronous so cannot await the network, and the exit policy is the application's. Only the
  `globalHandlers` integration uses `process.on` (flush timeout 2000 ms). Page-hide watching IS
  automatic in the OTLP sink (detected when `lifecycle` omitted, `{}` disables) and is removed on
  `flush`/`close`-completion via `#unwatch`.
- Sink contract: `write(record, resource): void`, returned promises ignored, sync throws to
  `onSinkError` (`record.ts`, `emit.ts` emitRecord). Records are deeply frozen and shared by all
  sinks, so a buffer can hold them by reference. `resource()` is a new frozen object per read, so
  group by structural Resource key if batches must not mix (ADR-0022 http-json).
- A wrapper's async inner-flush rejections are nobody's: the provider never observes them, so the
  wrapper must route them to its own `onError`/`onDrop`.
