---
about: redaction's only throw site is pseudonymize's build-time TypeError for a bad key; every other bad option clamps; string length there is UTF-16 code units, mask included; ADR-0002 does not address built-in errors or common-less packages
saw:
  - docs/adr/0002-custom-errors-carry-a-code-and-a-type-guard.md
  - docs/adr/0015-masking-and-pseudonymization-are-synchronous-replacements.md
  - source/core/packages/redaction/src/pseudonymize.ts
  - source/core/packages/redaction/src/mask.ts
  - source/core/packages/redaction/src/limits.ts
  - source/core/packages/redaction/src/detector.ts
  - source/core/packages/redaction/src/key-matcher.ts
  - source/core/packages/observability/src/logger/config-error.ts
---
- Non-test redaction src has exactly one authored throw: `resolveKey` in `pseudonymize.ts` throws a built-in `TypeError` when `key` is not a non-empty string or `Uint8Array`. It runs when the Replacement is built, never per value, because a throw inside `redact` makes the logger drop the record silently. Every other option clamps or takes a default (`resolveKeep`, `resolveLength`, `resolvePrefix`, `resolveMaskChar`, `resolveLimits`). The other `toThrow(TypeError)` tests are frozen policies (secret-keys.test.ts, compose-policies.test.ts), engine-thrown, not authored.
- ADR-0002 says "Every custom error the framework raises extends VipengeleError"; it is silent on built-in TypeError/RangeError and on packages that cannot import common. redaction cannot import `VipengeleError` (AGENTS.md: no common import), so the built-in `TypeError` is the decided answer there (ADR-0015 "The key is checked once, at build time"; a one-off error class is a rejected option). common's README documents `new Locale` throwing a built-in RangeError, so built-ins for misuse have precedent. Observability throws LoggingConfigError (logger/categories.ts, levels.ts).
- Length unit: `truncateString` (limits.ts), `maskKeepLast` (`slice(-count)`, mask.ts) and the `length` option count UTF-16 code units; a cut can split a surrogate pair. Code points appear only for walking (detector zero-length-match advance, key-matcher tokenization) and for taking the first code point of `maskChar`. No grapheme (Intl.Segmenter) use anywhere in redaction.
