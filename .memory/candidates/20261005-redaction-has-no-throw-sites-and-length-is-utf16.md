---
about: redaction src has zero throw sites and never validates options; string length there is UTF-16 code units; ADR-0002 does not address built-in errors or common-less packages
saw:
  - docs/adr/0002-custom-errors-carry-a-code-and-a-type-guard.md
  - source/core/packages/redaction/src/limits.ts
  - source/core/packages/redaction/src/detector.ts
  - source/core/packages/redaction/src/key-matcher.ts
  - source/core/packages/observability/src/logger/config-error.ts
---
- `grep 'throw |TypeError|RangeError|new Error'` over source/core non-test redaction src: 0 hits. The only `toThrow(TypeError)` are tests of frozen policies (secret-keys.test.ts:54-60, compose-policies.test.ts:65-68), engine-thrown, not authored.
- ADR-0002 says "Every custom error the framework raises extends VipengeleError"; it is silent on built-in TypeError/RangeError and on packages that cannot import common. common's README documents `new Locale` throwing a built-in RangeError (common/README.md:133, 172), so built-ins for misuse have precedent in common. Observability throws LoggingConfigError (logger/categories.ts:34, levels.ts:41). redaction has no VipengeleError access (AGENTS.md: no common import), so a custom error there is an unresolved conflict; nobody has decided it.
- redaction's convention for bad numeric options is clamp, not throw: resolveLimits floors/clamps maxBreadth, NaN disables a limit (limits.ts:42-49).
- Length unit: truncateString uses `value.length`/`slice`, UTF-16 code units, documented (limits.ts:51, redact.ts:42-45, AGENTS.md "Lengths are UTF-16 code units"); can cut a surrogate pair. Code points appear only for walking: detector zero-length-match advance (detector.ts:65) and key tokenization (key-matcher.ts:81). No grapheme (Intl.Segmenter) use anywhere in redaction. A "keep last N characters" mask has no mandated unit.
