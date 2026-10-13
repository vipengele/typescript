---
about: ADR-0005 already fixes where configuration sources (VPG_LOG, browser sources, installConsole) sit in precedence and that they are opt-in; the code has none of them and the layer model has no slot for the env layer
saw:
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - source/core/packages/observability/src/logger/settings.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/builder.ts
  - source/core/packages/observability/README.md
  - source/core/packages/common/src/runtime/capabilities.ts
  - source/core/packages/common/src/runtime/identity.ts
---
- ADR-0005 lines 67-75 record precedence, lowest first: defaults, builder sources in add order, live overrides, then `VPG_LOG` (always last, lazy on first level resolution, survives `clearDefaults()`/`reset()`, removed only by `.ignoreEnvironment()`). Browser sources (`addBrowserSources()`, `?log=` and localStorage) are opt-in layers in the builder (ADR example line 15). `Logging.installConsole(name)` is the explicit live switch and must confirm each change with its own record (lines 73-75). Bad spec entry in env/URL/storage warns; bad level in code throws (87-89). Considered-and-rejected: reading every source automatically (106-107).
- None of it exists: `grep -rnE "installConsole|addBrowserSources|ignoreEnvironment|localStorage|location\.search"` over source/core/packages (no dist, no node_modules) hits nothing. README.md:249 says the logger has no configuration sources.
- Layer model gap: `LAYER_ORDER = ["defaults","builder","overrides"]` (settings.ts:19) with a comment that the env layer belongs after `overrides` (settings.ts:15-17). `LoggingLayers` is `Record<LayerName, LevelLayer>` so adding an env layer changes the snapshot shape and `createSettings`/`reset`/`override` in provider.ts (126, 194, 227, 231), which all rebuild layers explicitly.
- Live change already works without a source feature: `Logging.override(category, level)` -> `commit` -> `publish` -> `publishLevelTable` replaces the shared slot; Loggers resolve via `resolveSharedEntry` on every call (logging.ts:118, slots.ts:165). A console handle should call `override`, not touch the table (see level-tables-are-replaced-never-mutated).
- Env reads: `readEnvironment` in common/src/runtime/capabilities.ts:21-27 is the guarded reader (try/catch because Deno without --allow-env throws), over `RuntimeSource.process.env` (identity.ts:22). `RuntimeSource` has `window`/`document` but no `location` or `localStorage` field (identity.ts:10-27): no precedent for a guarded storage/URL read exists in the repo.
- CONTEXT.md has no term for a configuration source; ADR-0005 uses "source" for builder inputs (`addLevels`, `addSpec` push `Source`, builder.ts:107). No mention of hatua or issue #10 in docs/, agentic/, .memory/.
