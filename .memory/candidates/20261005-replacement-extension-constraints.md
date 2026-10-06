---
about: partial masking and HMAC pseudonymization are Replacement functions; sync-only redact, no conditional exports and no importable package errors constrain how
saw:
  - CONTEXT.md
  - docs/adr/0014-value-detectors-replace-matched-spans.md
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - docs/adr/0015-masking-and-pseudonymization-are-synchronous-replacements.md
  - source/core/packages/redaction/src/replacement.ts
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/redaction/src/hmac-sha256.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/redaction/package.json
---
- Decided: CONTEXT.md (Replacement) says "partial masking and pseudonymization are additional Replacements, not a different mechanism"; ADR-0014 "Considered options" rejects a separate `onMatch` callback for the same reason; ADR-0015 records the implementation (`maskKeepLast`, `pseudonymize`).
- `Replacement = string | ((value: unknown, key: string) => unknown)` (replacement.ts). Widening to a union breaks ADR-0014's "replacement signature is unchanged" and every function Replacement; ADR-0014 also rejected widening `key` to `string|undefined` as breaking.
- `redact` is sync and returns `unknown`. Observability calls it synchronously on every record, inside a try/catch that drops the record on throw (emit.ts, record.ts). An async redact cannot be used there. The logger passes `policy` only, never a `replacement` (emit.ts), so the logger cannot apply masking or HMAC unless the policy or setting grows a replacement slot (undecided); the README says so.
- ADR-0004: no `node`/`browser` export conditions; Node built-ins only through `process.getBuiltinModule` and `import type`. node:crypto is a built-in, so a conditional split is against the ADR. WebCrypto's HMAC is async-only, so the package carries its own synchronous SHA-256/HMAC in `hmac-sha256.ts`. redaction's package.json has a single `.` export and no deps; AGENTS.md says it cannot import ts-core-common, hence no `VipengeleError`.
- Replacement output is neither walked nor bounded (redact.test.ts), and for detector spans a non-string return is String()-ed (redact.ts; url.ts, query-string.ts, headers.ts also String() it). Under a matched key the raw value (any type) is passed and the return used as-is, which is why both factories convert primitives with `String()` and answer an object with `"[REDACTED]"`.
- A throwing replacement propagates (headers.ts); in the logger that drops the record silently, so `pseudonymize` validates its key when it is built and the returned replacement never throws.
