---
about: partial masking and HMAC pseudonymization are already decided to be Replacement functions; sync-only redact, no conditional exports, no package errors constrain how
saw:
  - CONTEXT.md
  - docs/adr/0014-value-detectors-replace-matched-spans.md
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - source/core/packages/redaction/src/replacement.ts
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/redaction/package.json
---
Researched for issue #23 (partial masking + HMAC pseudonymization).

- Decided: CONTEXT.md:48-51 (Replacement) says "partial masking and pseudonymization are additional Replacements, not a different mechanism"; ADR-0014 "Considered options" rejects a separate `onMatch` callback for the same reason (line ~83).
- `Replacement = string | ((value: unknown, key: string) => unknown)` (replacement.ts:9). Widening to a union breaks ADR-0014's "replacement signature is unchanged" and every function Replacement; ADR-0014 also rejected widening `key` to `string|undefined` as breaking.
- `redact` is sync and returns `unknown` (redact.ts:88). Observability calls it synchronously on every record, inside a try/catch that drops the record on throw (emit.ts:31, :61, :119-134; record.ts:78-79). An async redact cannot be used there. The logger passes `policy` only, never a `replacement` (emit.ts:19-31), so the logger can never apply masking/HMAC unless the policy/setting grows a replacement slot (undecided).
- ADR-0004: no `node`/`browser` export conditions; Node built-ins only through `process.getBuiltinModule` and `import type`. Conditions are "the escape hatch for a future dependency that exists only for one runtime and is not a built-in". node:crypto is a built-in, so a conditional split is against the ADR; lazy detection is the sanctioned route. redaction's package.json has a single `.` export, no deps (package.json:32-38); AGENTS.md says it cannot import ts-core-common.
- Nothing in repo mentions hmac/pseudonym/createHmac/crypto.subtle (grep, 0 hits outside CONTEXT.md and ADR-0014). Not considered or rejected beyond the "is a Replacement" line.
- Replacement output is neither walked nor bounded (redact.test.ts:513-520), and for detector spans a non-string return is String()-ed (redact.ts:128; url.ts:122, query-string.ts:72, headers.ts:36 also String() it). Under a matched key the raw value (any type) is passed and the return used as-is.
- redaction has no custom errors (grep for Error/throw in non-test src: 0 class definitions); every helper "never throws on its contents" (url.ts:140, query-string.ts:110). A throwing replacement propagates (headers.ts:51); in the logger that drops the record silently.
