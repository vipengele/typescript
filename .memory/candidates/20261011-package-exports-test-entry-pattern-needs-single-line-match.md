---
about: package-exports.test.ts extracts tsup entries with a regex, and a greedy pattern breaks once Biome collapses the entry array onto one line
saw:
  - source/core/packages/common/src/package-exports.test.ts
  - source/core/packages/resilience/src/package-exports.test.ts
  - source/core/packages/resilience/tsup.config.ts
---
- common's copy matches tsup entries with `/"src\/(.+)\/index\.ts"/g` (package-exports.test.ts:18). `.+` is greedy, so when Biome formats a short `entry` array onto one line, one match swallows several entries and the test fails. It passes in common only because that `entry` array is long enough for Biome to keep one entry per line.
- resilience's copy uses `/"src\/([^"]+)\/index\.ts"/g`, which matches each quoted entry separately regardless of formatting. A new package copying common's test verbatim fails as soon as its entries fit on one line.
