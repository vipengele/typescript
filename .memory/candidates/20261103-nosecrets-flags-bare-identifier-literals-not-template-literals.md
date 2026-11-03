---
about: "biome's noSecrets flags a bare string literal of a camelCase function name such as \"createOtlpLogSink\", but not the same name inside a longer template literal; delivery option messages are built that way so shipped code carries no suppression"
saw:
  - source/core/packages/observability/src/delivery/options.ts
  - source/core/packages/observability/src/logger/otlp-sink.ts
  - source/core/packages/observability/src/errors/transports/otlp-transport.ts
  - source/core/biome.json
---
`lint/security/noSecrets` scores a string literal by entropy, and a bare camelCase identifier such as
`"createOtlpLogSink"` or `"createOtlpLogSink()"` scores high enough to be flagged; passing it as an
argument trips `pnpm lint --error-on-warnings`. The same name at the start of a template literal
(`` `createOtlpLogSink expects ${problem}` ``) is not flagged. So `deliveryOptionsProblem(url, limits)`
(`src/delivery/options.ts`) takes no caller name and returns only the text after "<caller> expects ";
`otlp-sink.ts` and `otlp-transport.ts` each write their own name into the message they throw
(`LoggingConfigError` and `ReporterConfigError`), and neither needs a `biome-ignore`. Tests that name
the function in a plain string still need the suppression (`src/logger/index.test.ts`).
