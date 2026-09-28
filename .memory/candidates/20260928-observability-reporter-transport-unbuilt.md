---
about: the errors and logger entry points of @vipengele/ts-core-observability are still empty stubs; ADRs 0004-0008 are the only recorded design for the Reporter/Transport/Sink pipeline
saw:
  - source/core/packages/observability/src/errors/index.ts
  - source/core/packages/observability/src/logger/index.ts
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
  - CONTEXT.md
---

Researched while scoping issue #54 (browser unload/offline delivery for the error reporter),
whose siblings under parent issue #11 — #37 Reporter core, #44 Transport contract, #45 HTTP JSON
transport — are all still open.

Both `source/core/packages/observability/src/errors/index.ts` and
`.../src/logger/index.ts` are literally `export {};` — no Reporter, no Transport interface, no
Sink interface, no Logger class exists in code yet. `errors/index.test.ts` and
`logger/index.test.ts` are placeholder smoke tests (`expect(entry).toBeTypeOf("object")`).

What *is* recorded, in ADRs rather than code:

- ADR-0007 gives the `LogRecord`/`ErrorEvent`/`SerializedError`/`Mechanism`/`Breadcrumb` data
  model precisely (fields, OTLP mapping), and CONTEXT.md's `Transport` glossary entry says a
  Transport "owns batching, retry, `flush()` and `close()`" — but no `Transport` interface,
  method signatures beyond that, or `Sink` interface appears anywhere in `source/`.
- ADR-0005 describes the Logger/LoggerProvider/builder shape and a `Sink` concept only at the
  level of "Sinks form a list the build replaces" — again no concrete `Sink` type in code.
- ADR-0004 is the only place `sendBeacon` is mentioned in the whole repo (grepped
  `sendBeacon|keepalive|IndexedDB|pagehide|visibilitychange` across `docs/` and `source/`,
  excluding `node_modules`): it lists `sendBeacon` as one example of a capability chosen by lazy,
  cached feature detection rather than a `typeof window` check or a conditional `exports`
  target. Nothing about `pagehide`/`visibilitychange` timing, an IndexedDB offline queue, or a
  size-bounded flush-at-startup design exists anywhere in `docs/adr/` or `source/`.
- ADR-0006 fixes that the Reporter reads the same Scope tree as the Logger (breadcrumbs = tagged
  ancestor scopes, no separate buffer) and ADR-0008 fixes that trace correlation and OTel export
  are opt-in entry points, not part of the core Transport.

Implication for planning #54: there is no Transport contract (#44) to build against yet, so an
unload/offline delivery layer cannot literally be "a decorator around a Transport interface"
without first landing (or co-designing) #44's interface — doing so purely inside #54 would
pre-empt #44 rather than consume it. The ADRs constrain the shape any Transport eventually takes
(JSON-safe payloads per ADR-0007, Resource sent once per payload, `flush()`/`close()` per
CONTEXT.md) but do not yet fix its TypeScript signature.
