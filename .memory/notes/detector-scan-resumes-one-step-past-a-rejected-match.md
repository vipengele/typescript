---
name: detector-scan-resumes-one-step-past-a-rejected-match
kind: rationale
description: The detector scan resumes a validate-rejected or zero-length match one code point past its start, not at its end, so a secret starting inside rejected text is still found; detectors are normalized once per array identity.
anchors:
  - path: source/core/packages/redaction/src/detector.ts
    blob: 296fb25b20b9
confidence: verified
---

A regex cannot retry a shorter candidate after `validate` rejects a longer one. `detector.ts:47-65`
therefore sets `lastIndex` to `start + 1` (or `+ 2` for an astral code point, `:65`) after a rejected
or zero-length match. Resuming at the match's end skipped a real card number that began inside a
rejected 4-6-4 reference number. The cost is one match attempt per start position inside a rejected
match, which a caller's own `pattern` and `validate` pay.

Detectors are normalized once per `detectors` array identity (`normalizedByDetectors` WeakMap,
`detector.ts:21`), so mutating the array afterwards has no effect (same idea as
[[key-matcher-normalizes-once-per-policy-object]]).
