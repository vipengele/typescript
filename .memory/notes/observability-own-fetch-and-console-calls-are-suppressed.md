---
name: observability-own-fetch-and-console-calls-are-suppressed
kind: invariant
description: Every fetch or console call the observability package itself makes is wrapped in suppressBreadcrumbs at the call expression, or autoBreadcrumbs records the package's own traffic.
anchors:
  - path: source/core/packages/observability/src/breadcrumb-suppression.ts
    blob: 53a1d3f651e5
  - path: source/core/packages/observability/src/delivery/*.ts
    matches:
      - path: source/core/packages/observability/src/delivery/delivery.test.ts
        blob: 89bfa4438cfb
      - path: source/core/packages/observability/src/delivery/delivery.ts
        blob: 97fd72be6151
      - path: source/core/packages/observability/src/delivery/options.test.ts
        blob: b4ce48a5b7b3
      - path: source/core/packages/observability/src/delivery/options.ts
        blob: 61aaa9499495
      - path: source/core/packages/observability/src/delivery/retry-policy.test.ts
        blob: 7a06733cd829
      - path: source/core/packages/observability/src/delivery/retry-policy.ts
        blob: b9ff9f47b5e4
      - path: source/core/packages/observability/src/delivery/unload.browser.test.ts
        blob: 157dee11d595
      - path: source/core/packages/observability/src/delivery/unload.test.ts
        blob: 2e539315605e
      - path: source/core/packages/observability/src/delivery/unload.ts
        blob: 94710e3397b8
  - path: source/core/packages/observability/src/delivery/offline/*.ts
    matches:
      - path: source/core/packages/observability/src/delivery/offline/fake-indexed-db.test-support.ts
        blob: 6d605334c231
      - path: source/core/packages/observability/src/delivery/offline/offline-queue.test.ts
        blob: f60f47cc0018
      - path: source/core/packages/observability/src/delivery/offline/offline-queue.ts
        blob: 7442515a333e
      - path: source/core/packages/observability/src/delivery/offline/store.browser.test.ts
        blob: 420a57011d07
      - path: source/core/packages/observability/src/delivery/offline/store.test.ts
        blob: 10b03bf5b8b4
      - path: source/core/packages/observability/src/delivery/offline/store.ts
        blob: ce294ea71b04
      - path: source/core/packages/observability/src/delivery/offline/wrapper.ts
        blob: a75fd317e601
  - path: source/core/packages/observability/src/errors/transports/*.ts
    matches:
      - path: source/core/packages/observability/src/errors/transports/console-transport.test.ts
        blob: 6f196fa3df05
      - path: source/core/packages/observability/src/errors/transports/console-transport.ts
        blob: 8c10f6226526
      - path: source/core/packages/observability/src/errors/transports/http-transport-config-error.test.ts
        blob: a1d91cb3048b
      - path: source/core/packages/observability/src/errors/transports/http-transport-config-error.ts
        blob: 553dc05cf456
      - path: source/core/packages/observability/src/errors/transports/http-transport.browser.test.ts
        blob: 52b92e9742a8
      - path: source/core/packages/observability/src/errors/transports/http-transport.test.ts
        blob: c08d3aeb8eeb
      - path: source/core/packages/observability/src/errors/transports/http-transport.ts
        blob: 8f89e4d82bba
      - path: source/core/packages/observability/src/errors/transports/otlp-transport.test.ts
        blob: 62f8ef5cf2ca
      - path: source/core/packages/observability/src/errors/transports/otlp-transport.ts
        blob: f58767a31cd3
      - path: source/core/packages/observability/src/errors/transports/test-transport.test.ts
        blob: 9578a1fad557
      - path: source/core/packages/observability/src/errors/transports/test-transport.ts
        blob: 139dbbd74440
  - path: source/core/packages/observability/src/errors/transports/http/*.ts
    matches:
      - path: source/core/packages/observability/src/errors/transports/http/classify.test.ts
        blob: d01bb5ed4c8b
      - path: source/core/packages/observability/src/errors/transports/http/classify.ts
        blob: 6a506ded5b90
      - path: source/core/packages/observability/src/errors/transports/http/options.test.ts
        blob: eeda1cc0159b
      - path: source/core/packages/observability/src/errors/transports/http/options.ts
        blob: d875d68859da
      - path: source/core/packages/observability/src/errors/transports/http/queue.test.ts
        blob: 115d5743b7a8
      - path: source/core/packages/observability/src/errors/transports/http/queue.ts
        blob: 606c125ee9b6
      - path: source/core/packages/observability/src/errors/transports/http/request.test.ts
        blob: 4eb4a2b80f34
      - path: source/core/packages/observability/src/errors/transports/http/request.ts
        blob: d7d5896c698a
      - path: source/core/packages/observability/src/errors/transports/http/retry-after.test.ts
        blob: c19ba2e292b6
      - path: source/core/packages/observability/src/errors/transports/http/retry-after.ts
        blob: 59d8a637db19
  - path: source/core/packages/observability/src/logger/*.ts
    matches:
      - path: source/core/packages/observability/src/logger/batching-sink.browser.test.ts
        blob: 8a355db6fdd2
      - path: source/core/packages/observability/src/logger/batching-sink.node.test.ts
        blob: 7f4cee9aed0f
      - path: source/core/packages/observability/src/logger/batching-sink.test.ts
        blob: b1bea47c6769
      - path: source/core/packages/observability/src/logger/batching-sink.ts
        blob: 9fca4b85832e
      - path: source/core/packages/observability/src/logger/browser-sources.browser.test.ts
        blob: b30b2c19ca4b
      - path: source/core/packages/observability/src/logger/browser-sources.node.test.ts
        blob: a501133657ae
      - path: source/core/packages/observability/src/logger/browser-sources.test.ts
        blob: fcd54d40a585
      - path: source/core/packages/observability/src/logger/browser-sources.ts
        blob: 254c8f0a1b14
      - path: source/core/packages/observability/src/logger/builder.test.ts
        blob: 1f207632f5b4
      - path: source/core/packages/observability/src/logger/builder.ts
        blob: ac754a406fe3
      - path: source/core/packages/observability/src/logger/categories.test.ts
        blob: 593a7995afce
      - path: source/core/packages/observability/src/logger/categories.ts
        blob: 9eec472f8f1f
      - path: source/core/packages/observability/src/logger/config-error.test.ts
        blob: 2c662ee2de71
      - path: source/core/packages/observability/src/logger/config-error.ts
        blob: 66e60f412804
      - path: source/core/packages/observability/src/logger/console-handle.browser.test.ts
        blob: dfd58526b018
      - path: source/core/packages/observability/src/logger/console-handle.test.ts
        blob: f4dff75f2c6a
      - path: source/core/packages/observability/src/logger/console-handle.ts
        blob: 7481032f73ae
      - path: source/core/packages/observability/src/logger/console-sink.test.ts
        blob: 921de74f2bc6
      - path: source/core/packages/observability/src/logger/console-sink.ts
        blob: a5de1003659f
      - path: source/core/packages/observability/src/logger/emit.node.test.ts
        blob: 23d828da76ce
      - path: source/core/packages/observability/src/logger/emit.test.ts
        blob: d3dc5e2670eb
      - path: source/core/packages/observability/src/logger/emit.ts
        blob: 07a3527a1303
      - path: source/core/packages/observability/src/logger/environment-source.node.test.ts
        blob: be1ae34035e8
      - path: source/core/packages/observability/src/logger/environment-source.test.ts
        blob: a5b9e972156d
      - path: source/core/packages/observability/src/logger/environment-source.ts
        blob: 35320e7f775a
      - path: source/core/packages/observability/src/logger/formatter.test.ts
        blob: 544a9cd5632f
      - path: source/core/packages/observability/src/logger/formatter.ts
        blob: 7aea36f0bd43
      - path: source/core/packages/observability/src/logger/hot-path.node.test.ts
        blob: be79c9c67ecd
      - path: source/core/packages/observability/src/logger/hot-path.test.ts
        blob: a38fd77b7e4e
      - path: source/core/packages/observability/src/logger/index.test.ts
        blob: 76d441ff6afe
      - path: source/core/packages/observability/src/logger/index.ts
        blob: eebf035d5a84
      - path: source/core/packages/observability/src/logger/levels.test.ts
        blob: 274deb7eb0d9
      - path: source/core/packages/observability/src/logger/levels.ts
        blob: 1e3486904edb
      - path: source/core/packages/observability/src/logger/logger.test.ts
        blob: 06d924c2aeda
      - path: source/core/packages/observability/src/logger/logger.ts
        blob: 3c00a0ce3bb6
      - path: source/core/packages/observability/src/logger/logging.test.ts
        blob: a52a1f79bbb5
      - path: source/core/packages/observability/src/logger/logging.ts
        blob: 39e7355bc1cb
      - path: source/core/packages/observability/src/logger/no-errors-import.node.test.ts
        blob: 7bc96000f878
      - path: source/core/packages/observability/src/logger/normalized.test.ts
        blob: 3d5978863b8c
      - path: source/core/packages/observability/src/logger/normalized.ts
        blob: 8aa561e63c6d
      - path: source/core/packages/observability/src/logger/otlp-sink.test.ts
        blob: 03c6ccc59c43
      - path: source/core/packages/observability/src/logger/otlp-sink.ts
        blob: a7c21063e5c4
      - path: source/core/packages/observability/src/logger/policy.test.ts
        blob: 8a326e3bd0df
      - path: source/core/packages/observability/src/logger/policy.ts
        blob: 12046d493b27
      - path: source/core/packages/observability/src/logger/provider.test.ts
        blob: 68e524161f30
      - path: source/core/packages/observability/src/logger/provider.ts
        blob: 1a912861cd7e
      - path: source/core/packages/observability/src/logger/record.ts
        blob: b944139ea8d9
      - path: source/core/packages/observability/src/logger/redaction-processor.test.ts
        blob: 4153f46c8a9f
      - path: source/core/packages/observability/src/logger/redaction-processor.ts
        blob: 54952808e3cf
      - path: source/core/packages/observability/src/logger/sampling.test.ts
        blob: f3d5310f5383
      - path: source/core/packages/observability/src/logger/settings.node.test.ts
        blob: baaf7b994e9b
      - path: source/core/packages/observability/src/logger/settings.test.ts
        blob: c2644df6bcfb
      - path: source/core/packages/observability/src/logger/settings.ts
        blob: 185e662be42b
      - path: source/core/packages/observability/src/logger/slots.test.ts
        blob: 53325c61da5a
      - path: source/core/packages/observability/src/logger/slots.ts
        blob: 4c510069b224
      - path: source/core/packages/observability/src/logger/spec.test.ts
        blob: a9ef65ed9a55
      - path: source/core/packages/observability/src/logger/spec.ts
        blob: f4ae7bf03fce
      - path: source/core/packages/observability/src/logger/test-sink.test.ts
        blob: aa0a87d8fbda
      - path: source/core/packages/observability/src/logger/test-sink.ts
        blob: 53e7e920af0b
confidence: verified
---

Transports, sinks and warnings look up `globalThis.fetch` and `console` at call time, so once the
`autoBreadcrumbs` integration patches them the package's own delivery and console output would
land in the breadcrumb trail. Each such call is written as `suppressBreadcrumbs(() => <call>)`;
the counter lives in the `Symbol.for("vipengele:breadcrumbs:suppressed:v1")` slot
(`source/core/packages/observability/src/breadcrumb-suppression.ts:6,20`).

Rules that are easy to get wrong:

- Wrap the call expression, not the capture. `defaultFetch` in `delivery/delivery.ts:175` is a
  capture and stays unwrapped; the calls at `delivery/delivery.ts:364` and `:558` (the unload
  keepalive) are wrapped. Same in `errors/transports/http/request.ts:220`.
- Suppression covers the synchronous call only. The patched fetch and XHR read it when the
  request starts and carry the answer to settlement.
- The non-test call sites today are in `delivery/delivery.ts`, `delivery/offline/offline-queue.ts`,
  `errors/transports/http-transport.ts`, `errors/transports/http/request.ts`,
  `errors/transports/console-transport.ts`, `errors/integrations/global-handlers.ts`,
  `logger/provider.ts`, `logger/console-sink.ts` and `logger/logging.ts`
  (`grep -rn "suppressBreadcrumbs(" src`).

A new transport, sink or warning that calls fetch or console bare breaks the invariant silently.
