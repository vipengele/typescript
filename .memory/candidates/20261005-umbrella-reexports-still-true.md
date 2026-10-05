---
about: umbrella still re-exports redaction names individually; Replacement type is re-exported there
saw:
  - source/ts/packages/ts/src/index.ts
targets: umbrella-reexports-names-individually
verdict: still-true
---
index.ts:23-31 lists redact, redactHeaders, redactQueryString, redactUrl, ... by name, and line 31 re-exports types Detector, RedactionPolicy, KeyMatcher, RedactOptions, RedactStringOptions, Replacement. Any new exported helper (e.g. a mask/pseudonymize factory) must be added there by hand.
