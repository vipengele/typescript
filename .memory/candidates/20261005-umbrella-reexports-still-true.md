---
about: umbrella still re-exports redaction names individually, helpers and types alike; Replacement, MaskOptions and PseudonymizeOptions are re-exported there
saw:
  - source/ts/packages/ts/src/index.ts
targets: umbrella-reexports-names-individually
verdict: still-true
---
index.ts lists redact, redactHeaders, redactQueryString, redactUrl, maskKeepLast, pseudonymize and the detectors by name in one `export { … } from "@vipengele/ts-core-redaction"` block, and a separate `export type { … }` block carries Detector, MaskOptions, PseudonymizeOptions, RedactionPolicy, KeyMatcher, RedactOptions, RedactStringOptions and Replacement. Any new exported helper must be added there by hand, with its option types in the type block; the umbrella resolves redaction through `dist/`, so core is built before the umbrella is type-checked.
