---
about: how the logger's VPG_LOG layer, browser-source clearing and console handle are wired, and the invariants that keep them from breaking Loggers or storage
saw:
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/environment-source.ts
  - source/core/packages/observability/src/logger/browser-sources.ts
  - source/core/packages/observability/src/logger/builder.ts
  - source/core/packages/observability/src/logger/console-handle.ts
  - source/core/packages/observability/src/logger/settings.ts
---
- `LAYER_ORDER` is defaults, builder, overrides, environment (`settings.ts`). The provider starts with an empty environment layer and brings `VPG_LOG` in on its first `configure`/`override`/`reset` or its first Logger level check (`settle()` in `provider.ts`); creating a provider or a Logger reads nothing. `settle()` runs inside a Logger call, so it swallows a throwing `publish` or `onIssues`. `readEnvironmentSpec` (`environment-source.ts`) is observability's own guarded `process.env` reader; it is separate from common's `readEnvironment` and common exports nothing for it.
- `Logging.createProvider` providers read `VPG_LOG` too (each caches its own raw value); `createLoggerProvider` with no `environment` option has no environment layer, which keeps isolated test providers independent of the operator's environment.
- `build()` is side-effect free. `addBrowserSources` reads at call time; a stored spec that holds no level is recorded in a `WeakMap` keyed by the build (`builder.ts`) and removed by `clearUnreadableStoredSpecs` only after the provider has applied and published that build, and only while storage still holds the value read (`browser-sources.ts`). A bad URL parameter never marks storage for removal.
- The console handle changes levels through the provider's overrides (a single `setOverrides` commit), never `configure`, which would replace the sinks. Its confirmation is the one record that bypasses the level check: `confirm()` in `provider.ts` calls `emitRecord` directly under `vipengele.logger.console`, and with no sink it calls the provider's `warn` option. The stored spec is the previously stored spec merged with the newly applied levels, not the whole overrides layer, so overrides set from code are never persisted.
- A handle is recognised by a `Symbol.for("vipengele.logger.console-handle")` tag on the function, so a handle from another copy of the package may be replaced and anything else at `globalThis[name]` makes `installConsole` throw. `LoggerProvider` gained `installConsole` under the same `provider.v1` slot, so a default provider created by an older copy lacks it and `Logging.installConsole` throws `LoggingConfigError` for that case.
