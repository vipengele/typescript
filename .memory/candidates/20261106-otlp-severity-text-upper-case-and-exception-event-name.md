---
about: "OTLP export writes severityText as the upper-case Level name and names only exception-bearing Error Events \"exception\"; both encoders share src/otlp/severity.ts"
saw:
  - source/core/packages/observability/src/otlp/severity.ts
  - source/core/packages/observability/src/otlp/encode-error-events.ts
  - source/core/packages/observability/src/otlp/encode-logs.ts
  - docs/adr/0022-otlp-export-shares-one-delivery-core.md
---
- `severityOf` (`src/otlp/severity.ts`) returns `severityText` typed `Uppercase<Level>` (`"ERROR"`, not the Level's own `"error"`). `encode-logs.ts` and `encode-error-events.ts` both call it, so a change there changes the wire format of `createOtlpLogSink` and `createOtlpTransport` together (ADR-0022).
- `encodeEvent` in `src/otlp/encode-error-events.ts` sets `eventName: "exception"` only when `event.exception !== undefined`, after the trace fields so it is the last key; a captured message has no `eventName` key. `encode-logs.ts` never sets `eventName`.
- Key order of an encoded record is asserted in `src/otlp/encode-error-events.test.ts`, so adding a field to `encodeEvent` means updating that order assertion.
