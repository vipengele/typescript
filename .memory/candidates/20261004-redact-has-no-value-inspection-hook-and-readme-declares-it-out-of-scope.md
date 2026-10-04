---
about: redact() inspects only keys; strings are never scanned except truncateString, and the README declares value-pattern matching out of scope. Adding detectors touches a spec'd contract (replace whole value), 5 surfaces, and a 100% coverage gate.
saw:
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/redaction/src/replacement.ts
  - source/core/packages/redaction/src/key-matcher.ts
  - source/core/packages/redaction/README.md
  - source/ts/packages/ts/src/index.ts
  - source/ts/packages/ts/src/index.test.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/vitest.shared.ts
  - docs/adr/0011-redaction-presets-and-exceptions.md
  - docs/adr/0012-redact-helpers-read-strings-as-text-and-replace-whole-values.md
---

Found while answering a planning question for issue #22 (value-pattern detectors).

- `redact.ts:89-91` `walk()`: a string goes only to `truncateString`; the sole key-vs-value decision is
  `redactField` (`redact.ts:277`), which calls `matchKey` then `applyReplacement(replacement, value, key)`.
  Map string keys go through `redactField` (`:244`); Set members, array items and non-string Map keys are
  walked with no key, so a value-only detector would be the first thing to run on them.
- No compiled policy: the only precompilation is `normalizedPolicy()` in `key-matcher.ts` (WeakMap on policy
  object identity, ~`:151`), private to the key matcher. `WalkContext` (`redact.ts:52`) is built per call.
- `Replacement` is `string | (value, key) => unknown` (`replacement.ts:7`); there is no span API. ADR-0012
  ("Header values are replaced whole", rejected "keep the auth scheme as Bearer [REDACTED]") records
  whole-value replacement as the rule "that cannot leak". Span replacement would be a new contract.
- README.md:5 states "Value-pattern matching is outside this package's scope." That sentence must change.
- Policy shape ADR-0011 rationale: `except` was a policy field so presets compose; `composePolicies` and the
  key-matcher WeakMap cache are by policy object, so detectors on the policy would need composePolicies support.
- Umbrella: `source/ts/packages/ts/src/index.ts:5-6` lists names individually; `index.test.ts` has a per-name
  test, no exhaustive-export check, so omission is not caught mechanically. `agentic/vipengele-typescript.md:72-74`
  also lists the names.
- Observability calls `redact` in `logger/emit.ts` (`redactAttributes`, `redactSyntheticMessage`,
  `UNBOUNDED` options at `:19`) and `settings.ts:61` defaults to `secretKeys`. Error reporter does not call it.
  A real Error's `message`/`stack` are deliberately not scanned (see the emit candidate).
- Gates: `source/core/vitest.shared.ts:18-23` 100% statements/branches/functions/lines; biome `security: error`
  so credential-shaped test fixtures need `biome-ignore lint/security/noSecrets` (precedent `limits.ts:16`,
  `url.test.ts:1`); `key-matcher.ts` carries a nosemgrep on dynamic `new RegExp`. `core-redaction` is a lydite
  component with no extra thresholds (`.lydite/components.yml`). Redaction uses only root exports (ADR-0011).
- No git history or ADR on value matching was found (git log grep, docs grep): no prior attempt.
