---
about: no ADR, note or commit discusses redaction presets; CONTEXT.md pre-assigns them to the redaction package; the ts umbrella re-exports redaction by explicit name so new exports need a manual edit
saw:
  - CONTEXT.md
  - docs/adr/
  - source/ts/packages/ts/src/index.ts
  - source/core/packages/redaction/src/key-matcher.ts
  - source/core/packages/redaction/package.json
  - source/core/packages/observability/package.json
---

Checked for issue #19 planning (2026-10-01).

- CONTEXT.md:28-31 defines **Redaction Policy** and says "Composable presets and exceptions are
  `@vipengele/ts-core-redaction`'s own concern to add on top, not a separate glossary term."
  `grep -rni preset docs CONTEXT.md README.md` finds nothing else; `git log --grep=preset` is empty.
  No ADR covers redaction design (only mentions: 0007:116, 0008:31, 0001:7).
- `RedactionPolicy` is `{ keys: readonly KeyMatcher[] }` (key-matcher.ts:8-10); matchers are
  normalized once per policy object identity in a WeakMap (key-matcher.ts:16). A composing type must
  produce a fresh flat policy object, not mutate one.
- Bare string = exact, case-sensitive; RegExp is unanchored (README Caveats). `/token/` matches
  `csrfToken` only with `i`, and matches `tokenizer`.
- source/ts/packages/ts/src/index.ts:3-4 re-exports `redact` and types by name; new redaction
  exports do not reach `@vipengele/ts` unless added there. The ts project pins redaction exactly
  (package.json 0.0.2) with a link: override (ADR-0009).
- redaction exports only "." (package.json exports); observability depends on it via workspace:*
  but does not call redact yet. Coverage gate is 100% (source/core/vitest.shared.ts:18-22).
