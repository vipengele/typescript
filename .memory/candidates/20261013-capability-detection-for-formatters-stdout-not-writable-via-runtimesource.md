---
about: how detectCapability decides consoleStyling and ansiColour, that an injected source is read fresh, that the reset helper is not exported, and that RuntimeSource gives no way to write to stdout
saw:
  - source/core/packages/common/src/runtime/capabilities.ts
  - source/core/packages/common/src/runtime/identity.ts
  - source/core/packages/common/src/runtime/index.ts
  - source/core/packages/observability/src/logger/formatters/select.ts
  - source/core/packages/observability/src/logger/formatters/select.test.ts
---
- `consoleStyling` is true when `detectRuntime` is browser, worker or deno (`capabilities.ts:30-33`); Node, Bun and edge are false. `ansiColour` (`capabilities.ts:41-55`): no `process` -> false; non-empty `NO_COLOR` -> false (wins); `FORCE_COLOR` set -> true unless "0" or "false"; else `stdout.isTTY === true && TERM !== "dumb"`. It looks at stdout only.
- With an injected source `detectCapability(cap, source)` is evaluated afresh; without one it is memoised per module copy (`capabilities.ts:90-97`). `resetDetectedCapabilities` clears that memo but is NOT exported from `@vipengele/ts-core-common/runtime` (`runtime/index.ts` exports only `detectCapability`, `detectRuntime` and types), so a consumer's test controls the outcome by injecting a `source`; a bare call can only be asserted to return one of the three formatters.
- `selectConsoleFormatter` (`formatters/select.ts`): `consoleStyling` -> browser, else `ansiColour` -> ANSI, else JSON lines. Deno has both capabilities, so styling wins there.
- `RuntimeSource.process.stdout` is `{ isTTY }` only (`identity.ts`): no `write`. A Node stdout sink would need its own structural type for `globalThis.process.stdout.write` (no `node:` imports are allowed in src).
