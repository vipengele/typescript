---
about: how detectCapability decides consoleStyling and ansiColour, that it is injectable, and that RuntimeSource gives no way to write to stdout
saw:
  - source/core/packages/common/src/runtime/capabilities.ts
  - source/core/packages/common/src/runtime/identity.ts
  - source/core/packages/common/src/runtime/capabilities.test.ts
  - source/core/packages/observability/src/errors/runtime-context.ts
  - .lydite/components.yml
---
- `consoleStyling` = `detectRuntime` is browser, worker or deno (`capabilities.ts:30-33`). Node, Bun and edge are false.
- `ansiColour` (`capabilities.ts:41-55`): no `process` -> false; non-empty `NO_COLOR` -> false (wins); `FORCE_COLOR` set -> true unless "0"/"false"; else `stdout.isTTY === true && TERM !== "dumb"`. Env reads are try/caught (Deno permissions). It looks at stdout only, so stderr being a pipe is not considered.
- Injectable: `detectCapability(cap, source?)`: with a source it is evaluated afresh and never memoised (`capabilities.ts:90-97`); without one it is memoised per module copy, cleared by `resetDetectedCapabilities()`. Tests pass plain objects, e.g. `{ process: { env: {}, stdout: { isTTY: true } } }` (`capabilities.test.ts:11,55,96`). Both are exported from `@vipengele/ts-core-common/runtime`, which observability already imports (`errors/runtime-context.ts:1`, `errors/integrations/global-handlers.ts:1`).
- `RuntimeSource.process.stdout` is `{ isTTY?: unknown }` only (`identity.ts:~30`): no `write`. A Node stdout sink must reach `globalThis.process.stdout.write` itself with its own structural type (same pattern as `GlobalProcess` in global-handlers.ts), or take a `write` function option. Writing via `console.log` is the no-import alternative.
- lydite: components are whole package dirs (`.lydite/components.yml`, `core-observability` dir source/core/packages/observability), so a new file under src/ needs no registration; it only needs 100% coverage in the union of node and chromium runs. Node-only code goes in `*.node.test.ts`, browser-only in `*.browser.test.ts` (precedent `errors/runtime-context.node.test.ts`, `logger/emit.node.test.ts`).
- logger `src/logger/index.test.ts` asserts the exact runtime export list (`Object.keys(entry).sort()`), so any new runtime export must be added there; types are checked separately. The umbrella `@vipengele/ts` does not re-export observability.
