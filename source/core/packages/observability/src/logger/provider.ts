import type { Threshold } from "@vipengele/ts-core-common";
import { createLoggingBuilder, type LoggingBuilder } from "./builder";
import { validateCategoryKey } from "./categories";
import { entryFor, type LevelEntry, resolveEntry, validateThreshold } from "./levels";
import { createLogger, type Logger } from "./logger";
import { DEFAULT_LEVELS, EMPTY_LAYER, createSettings, type LoggingSettings } from "./settings";

/**
 * Composes a provider's configuration on the fresh builder it is handed. Its return value is
 * ignored, so it may return the builder from a chain or nothing at all.
 */
export type ConfigureCallback = (builder: LoggingBuilder) => void;

/**
 * Hooks a host wires into a {@link LoggerProvider}. A provider built without any reads and writes
 * only its own state and never touches `globalThis`.
 */
export interface LoggerProviderOptions {
  /**
   * Called once per successful `configure` — the one passed to {@link createLoggerProvider}
   * included — with the build's spec issues, after the new configuration is in force. Never
   * called when there are none, or when the configuration is rejected.
   */
  onIssues?(issues: readonly string[]): void;

  /**
   * Called with the new snapshot after every successful `configure`, `override` and `reset`, even
   * one that leaves the levels as they were. Not called for the configuration a provider starts with, the one passed to
   * {@link createLoggerProvider} included: a provider publishes only what is changed on it.
   */
  publish?(settings: LoggingSettings): void;

  /**
   * Where the provider's Loggers read the entry that governs their category, on every call. When
   * omitted, the provider's own current effective table is resolved, a table with no matching key
   * and no root falling back to `warn`.
   */
  resolve?(category: string): LevelEntry;
}

/**
 * Owns one configuration — the defaults, builder and overrides layers of a `LoggingSettings` —
 * and hands out Loggers that read it on every call.
 */
export interface LoggerProvider {
  /**
   * Rebuilds the builder layer from the defaults: `configure` runs on a fresh builder, whose
   * `build()` validates everything before the result replaces the defaults and builder layers in
   * one step. Live overrides are kept; only `reset` drops them. Throws a `LoggingConfigError` on an
   * invalid level or category, leaving the configuration in force untouched. Returns a snapshot of
   * the new configuration.
   */
  configure(configure: ConfigureCallback): LoggingSettings;

  /**
   * Sets the override for `category` (a Category or the root `*`) to `level`, or removes it when
   * `level` is `null`, letting the layers beneath show through. Throws a `LoggingConfigError` on
   * an invalid category key or level, changing nothing. Returns a snapshot of the new
   * configuration.
   */
  override(category: string, level: Threshold | null): LoggingSettings;

  /**
   * Drops every override and the builder layer and restores the defaults (`{ "*": "warn" }`).
   * Returns a snapshot of the new configuration.
   */
  reset(): LoggingSettings;

  /** A Logger for `category`; throws a `LoggingConfigError` when it is not a Category. */
  logger(category: string): Logger;
}

const FALLBACK_LEVEL = "warn";

/**
 * A new {@link LoggerProvider} starting from the defaults, then from `configure` when one is
 * given; an invalid starting configuration throws a `LoggingConfigError`. Its state is its own:
 * nothing outside it is read or written except through `options`.
 */
export function createLoggerProvider(configure?: ConfigureCallback, options: LoggerProviderOptions = {}): LoggerProvider {
  let settings = createSettings({ defaults: DEFAULT_LEVELS, builder: EMPTY_LAYER, overrides: EMPTY_LAYER });

  const resolve =
    options.resolve === undefined
      ? (category: string): LevelEntry => resolveEntry(settings.levels, category) ?? entryFor(FALLBACK_LEVEL)
      : options.resolve.bind(options);

  function commit(next: LoggingSettings): LoggingSettings {
    settings = next;
    options.publish?.(next);
    return next;
  }

  /** Builds and validates in full before anything is assigned, so a throw leaves `settings` as it was. */
  function rebuild(callback: ConfigureCallback): { readonly next: LoggingSettings; readonly issues: readonly string[] } {
    const builder = createLoggingBuilder();
    callback(builder);
    const build = builder.build();
    const next = createSettings({ defaults: build.defaults, builder: build.builder, overrides: settings.layers.overrides });
    return { next, issues: build.issues };
  }

  function reportIssues(issues: readonly string[]): void {
    if (issues.length > 0) {
      options.onIssues?.(issues);
    }
  }

  if (configure !== undefined) {
    const { next, issues } = rebuild(configure);
    settings = next;
    reportIssues(issues);
  }

  return Object.freeze({
    configure(callback: ConfigureCallback): LoggingSettings {
      const { next, issues } = rebuild(callback);
      commit(next);
      reportIssues(issues);
      return next;
    },
    override(category: string, level: Threshold | null): LoggingSettings {
      const key = validateCategoryKey(category);
      const overrides: Record<string, Threshold> = Object.create(null);
      Object.assign(overrides, settings.layers.overrides);
      if (level === null) {
        delete overrides[key];
      } else {
        overrides[key] = validateThreshold(level);
      }
      return commit(createSettings({ ...settings.layers, overrides }));
    },
    reset(): LoggingSettings {
      return commit(createSettings({ defaults: DEFAULT_LEVELS, builder: EMPTY_LAYER, overrides: EMPTY_LAYER }));
    },
    logger(category: string): Logger {
      return createLogger(category, resolve);
    },
  });
}
