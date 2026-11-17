---
name: nosecrets-flags-bare-identifier-string-literals
kind: gotcha
description: Biome's noSecrets flags a bare string literal holding a camelCase function name but not the same name inside a longer template literal, which is why delivery option messages are built by each caller.
anchors:
  - path: source/core/packages/observability/src/delivery/options.ts
    blob: 61aaa9499495
  - path: source/core/packages/observability/src/logger/otlp-sink.ts
    blob: a7c21063e5c4
  - path: source/core/packages/observability/src/errors/transports/otlp-transport.ts
    blob: f58767a31cd3
  - path: source/core/packages/observability/src/logger/otlp-sink.test.ts
    blob: 03c6ccc59c43
confidence: verified
---

`lint/security/noSecrets` scores a string literal by entropy. A bare `"createOtlpLogSink"` scores
high enough to be flagged, and lint runs with warnings as errors. The same name at the start of a
template literal, `` `createOtlpLogSink expects ${problem}` ``, is not flagged.

That shapes the code: `deliveryOptionsProblem(url, limits)`
(`source/core/packages/observability/src/delivery/options.ts:45`) takes no caller name and
returns only the text after "expects"; each caller writes its own name into the message it
throws (`logger/otlp-sink.ts:80`, `logger/batching-sink.ts:86`,
`errors/transports/otlp-transport.ts:88`), and shipped code carries no suppression.

Tests that name a function in a plain string do need
`// biome-ignore lint/security/noSecrets: a function name, flagged only for its entropy`
(`logger/otlp-sink.test.ts:23,161`). Passing a caller name as a string argument to a shared
helper is the refactor that trips the rule.
