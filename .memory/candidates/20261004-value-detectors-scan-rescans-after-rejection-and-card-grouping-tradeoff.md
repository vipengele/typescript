---
about: Value detectors are policy fields scanned by detector.ts; a validate-rejected match is rescanned from its next character, which is why creditCard is limited to standard groupings, and unbounded token quantifiers are only linear behind a leading anchor.
saw:
  - source/core/packages/redaction/src/detector.ts
  - source/core/packages/redaction/src/value-detectors.ts
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/redaction/src/key-matcher.ts
  - source/core/packages/observability/src/logger/emit.ts
  - docs/adr/0014-value-detectors-replace-matched-spans.md
---

Learned while implementing issue #22 (opt-in value-pattern detectors); the design is in ADR-0014, these are the
parts that cost review passes to get right.

- `detector.ts` `scan`: a regex cannot retry a shorter candidate after `validate` rejects a longer one, so the
  scan resumes a rejected (or zero-length) match one step past its START, not at its end. Resuming at the end
  skipped a real card number that began inside a rejected 4-6-4 reference number. Cost is one match attempt per
  start position inside a rejected match, which a caller's own `pattern`/`validate` pays.
- `value-detectors.ts` `creditCard` accepts 13-19 contiguous digits or the standard 4-4-4-N, 4-6-4 and 4-6-5
  groupings with one consistent separator, and the candidate may be followed by a separator and digits. A looser
  "any single separator" pattern absorbed a trailing CVV or expiry into one long run that failed Luhn, leaking
  the PAN. A 4-4-4-4-3 alternative is deliberately absent: tried first it re-breaks the PAN-plus-CVV case.
- `jwt`/`bearerToken` have no length bound on purpose: a bound makes an oversized token fail to reach its dot
  and go unmatched, leaking it whole. They stay linear because a lookbehind / `\b` rejects a start inside a run
  in constant time. "Every quantifier is length-bounded" is NOT the safety argument for these.
- Detectors are normalized once per `detectors` ARRAY identity (WeakMap in `detector.ts`), separate from the key
  matcher's `normalizedPolicy` cache in `key-matcher.ts`; mutating the array afterwards has no effect.
- `redact.ts` `walk` scans before `truncateString` (scan the original, then truncate). The logger's
  `emit.ts` passes `UNBOUNDED` options, so with detectors on it scans attribute strings in full. An `Error`'s
  `name` is scanned along with `message`/`stack` because walkError routes every field through `redactField`.
- Detector tests assert span counts on 50k-character pathological inputs, never wall-clock time.
