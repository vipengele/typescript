---
name: package-exports-test-entry-regex-must-not-be-greedy
kind: gotcha
description: common's package-exports.test.ts extracts tsup entries with a greedy regex that only works while Biome keeps one entry per line; copy the resilience/http version instead.
anchors:
  - path: source/core/packages/common/src/package-exports.test.ts
    blob: c6529acee5be
  - path: source/core/packages/common/tsup.config.ts
    blob: 7197bb9cc9ec
  - path: source/core/packages/resilience/src/package-exports.test.ts
    blob: c315ddb92945
  - path: source/core/packages/http/tsup.config.ts
    blob: 19c14ae03517
confidence: verified
---

`source/core/packages/common/src/package-exports.test.ts:18` matches tsup entries with
`/"src\/(.+)\/index\.ts"/g`. `.+` is greedy, so once Biome collapses a short `entry` array onto one
line (as in `source/core/packages/http/tsup.config.ts:4`), one match swallows several entries and
the test fails. It passes in common only because that array is long enough to stay one entry per
line (`source/core/packages/common/tsup.config.ts:4-6`).

`source/core/packages/resilience/src/package-exports.test.ts:18` and http's copy use
`/"src\/([^"]+)\/index\.ts"/g`, which matches each quoted entry whatever the formatting. A new
package should copy that one, not common's.
