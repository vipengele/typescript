import type { Threshold } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { clearUnreadableStoredSpecs, createLoggingBuilder, type LoggingBuild, type LoggingBuilder } from "./builder";
import { validateCategoryKey } from "./categories";
import { CONSOLE_HANDLE_CATEGORY, installConsoleHandle } from "./console-handle";
import { emitRecord } from "./emit";
import { parseEnvironmentSpec } from "./environment-source";
import { type LevelEntry, resolveEntry, validateThreshold } from "./levels";
import { createLogger, type Logger } from "./logger";
import type { EmitSettings, LogProcessor, Sink } from "./record";
import { DEFAULT_LEVELS, EMPTY_LAYER, createSettings, freezeLayer, type LevelLayer, type LoggingSettings } from "./settings";
import { FALLBACK_ENTRY } from "./slots";

/**
 * Composes a provider's configuration on the fresh builder it is handed. Its return value is
 * ignored, so it may return the builder from a chain or nothing at all.
 */
export type ConfigureCallback = (builder: LoggingBuilder) => void;

/**
 * Hooks a host wires into a {@link LoggerProvider}. A provider built without any reads and writes
 * only its own state and never touches `globalThis`, except through a console handle it is asked
 * to install.
 */
export interface LoggerProviderOptions {
  /**
   * Called once per successful `configure` — the one passed to {@link createLoggerProvider}
   * included — with the build's spec issues, after the new configuration is in force. Never
   * called when there are none, or when the configuration is rejected. Called once more, on its
   * own, with the issues of the environment spec, each naming `VPG_LOG`, after the operation that
   * first reads it; a throw from that call is swallowed, since the read can happen inside a
   * Logger's level check, which never throws.
   */
  onIssues?(issues: readonly string[]): void;

  /**
   * Called with the new snapshot after every successful `configure`, `override` and `reset`, even
   * one that leaves the levels as they were. Not called for the configuration a provider starts with, the one passed to
   * {@link createLoggerProvider} included: a provider publishes only what is changed on it. Called
   * once more when a Logger's level check is the first operation to read the environment and the
   * environment layer holds a level, with the configuration in force plus that layer; a throw from
   * that call is swallowed and leaves the layer in force.
   */
  publish?(settings: LoggingSettings): void;

  /**
   * Reads the raw level spec of the environment layer: `VPG_LOG` for every provider `Logging`
   * makes. Asked at most once, by whichever comes first of the first `configure`, `override` or
   * `reset` and the first level check of one of the provider's Loggers, never when the provider is
   * created, and not while the build in force ignores the environment. A value that is not a
   * string, or a throw, reads as no spec; a bad entry is skipped and reported through `onIssues`.
   * When omitted, the environment layer is always empty.
   */
  environment?(): string | undefined;

  /**
   * Where the provider's Loggers read the entry that governs their category, on every call. When
   * omitted, the provider's own current effective table is resolved, a table with no matching key
   * and no root falling back to `warn`.
   */
  resolve?(category: string): LevelEntry;

  /**
   * The Resource handed to every sink, asked once per record. When omitted, every record carries
   * a frozen Resource whose keys are `undefined`.
   */
  resource?(): Resource;

  /**
   * Called with the thrown value of each `Sink.write` that fails, and of each processor that
   * throws or returns something other than a record or `null`, with the failing sink or processor
   * as `source`. Every failure is reported, unless `sinkErrorsOncePerSource` says otherwise. When
   * omitted, a failure is dropped.
   */
  onSinkError?(error: unknown, source: Sink | LogProcessor): void;

  /**
   * When `true`, `onSinkError` is called only for the first failure of each source, told apart by
   * identity, per configuration: a sink added twice, or a processor that runs both globally and
   * ahead of one sink, is reported once. A successful `configure` and every `reset` start a fresh
   * configuration, so a source that fails again is reported again; an `override` does not, since
   * it changes levels and leaves every sink and processor in place. Defaults to `false`.
   */
  sinkErrorsOncePerSource?: boolean;

  /**
   * Receives a console handle's confirmation as one line when the configuration in force has no
   * sink to write it to. When omitted, the line goes to `console.warn`.
   */
  warn?(message: string): void;
}

/**
 * Owns one configuration — the defaults, builder, overrides and environment layers of a
 * `LoggingSettings`, and the sinks, clock and redaction of its build — and hands out Loggers that
 * read it on every call. The environment layer sits above every other, so a level in `VPG_LOG`
 * beats the same category's level from the builder or an override.
 */
export interface LoggerProvider {
  /**
   * Rebuilds the builder layer from the defaults: `configure` runs on a fresh builder, whose
   * `build()` validates everything before the result replaces the defaults and builder layers, the
   * sinks, the clock and the redaction in one step. Sinks are replaced, never appended to those of
   * an earlier `configure`. Live overrides are kept; only `reset` drops them. The environment
   * layer is kept unless the builder calls `ignoreEnvironment()`, and comes back with the next
   * `configure` that does not. Throws a `LoggingConfigError` on an invalid level, category or
   * sink, leaving the configuration in force untouched. A stored browser spec the build found
   * unreadable is removed from storage once the new configuration is in force and published; a
   * rejected `configure` removes nothing. Returns a snapshot of the new configuration, the
   * environment layer included.
   */
  configure(configure: ConfigureCallback): LoggingSettings;

  /**
   * Sets the override for `category` (a Category or the root `*`) to `level`, or removes it when
   * `level` is `null`, letting the layers beneath show through. Throws a `LoggingConfigError` on
   * an invalid category key or level, changing nothing. An override never beats the environment
   * layer's level for the same category. Returns a snapshot of the new configuration, the
   * environment layer included.
   */
  override(category: string, level: Threshold | null): LoggingSettings;

  /**
   * Drops every override and the builder layer and restores the defaults (`{ "*": "warn" }`), and
   * with them the output of a build that sets none: no sinks, `systemClock`, the `secretKeys`
   * redaction and no browser sources. Storage is left as it is. The environment layer is kept,
   * and restored when the build in force ignored it. Returns a snapshot of the new configuration,
   * the environment layer included.
   */
  reset(): LoggingSettings;

  /** A Logger for `category`; throws a `LoggingConfigError` when it is not a Category. */
  logger(category: string): Logger;

  /**
   * Installs a console handle on this provider at `globalThis[name]` and returns the function that
   * removes it. The handle takes a level spec string, a `{ levels }` object, `null` or nothing. A
   * spec or `{ levels }` is validated whole — a skipped or repeated entry, or no level at all,
   * throws a `LoggingConfigError` and changes nothing — then merged into the overrides, as
   * `override` sets them; `null` removes every override; nothing reports the levels in force.
   *
   * While the build in force has browser sources, a change is also merged into the spec stored
   * under their storage key, and `null` removes that spec; the URL is never written. Blocked
   * storage leaves the change in force for the page alone. A stored spec comes back on the next
   * load as a builder source, below the overrides and below any source added after
   * `addBrowserSources`, and `reset` leaves it in storage.
   *
   * Every call confirms itself with one `info` record under `vipengele.logger.console`, written
   * whatever level governs that category, through the processors and sinks in force: it lists the
   * effective levels, names every override `VPG_LOG` takes precedence over and says whether the
   * change was stored. With no sink in force, the same line goes to the `warn` option instead.
   *
   * Throws a `LoggingConfigError` when `name` is not a non-empty string, or `globalThis[name]`
   * holds anything but `undefined` or a console handle, which is replaced. The returned function
   * removes the handle only while `globalThis[name]` is still this one.
   */
  installConsole(name: string): () => void;
}

/** The Resource of a provider given no `resource`: every key reserved, none set. */
function emptyResource(): Resource {
  return Object.freeze({
    "service.name": undefined,
    "service.version": undefined,
    "service.dist": undefined,
    "deployment.environment.name": undefined,
    "process.runtime.name": undefined,
    "process.runtime.version": undefined,
    "os.type": undefined,
    "os.version": undefined,
    "browser.name": undefined,
    "browser.version": undefined,
    "device.type": undefined,
  });
}

/**
 * A new {@link LoggerProvider} starting from the defaults, then from `configure` when one is
 * given; an invalid starting configuration throws a `LoggingConfigError`. A stored browser spec the
 * starting build found unreadable is removed from storage once that configuration is in force,
 * before its issues are reported. Its state is its own — its sink list included, which no other
 * provider shares: nothing outside it is read or written except through `options` and the browser
 * storage its builds read.
 */
export function createLoggerProvider(configure?: ConfigureCallback, options: LoggerProviderOptions = {}): LoggerProvider {
  let settings = createSettings({ defaults: DEFAULT_LEVELS, builder: EMPTY_LAYER, overrides: EMPTY_LAYER, environment: EMPTY_LAYER });

  /** Whether the build in force called `ignoreEnvironment()`. */
  let ignoring = false;

  /**
   * Whether `settings` carries the environment layer. A provider starts without it, so creating
   * one reads nothing; the first operation or level check brings it in.
   */
  let settled = false;

  /** The environment layer as parsed on the one read, `undefined` until then. */
  let environment: LevelLayer | undefined;

  /** The issues of the environment spec, held from the read until they are reported. */
  let environmentIssues: readonly string[] = [];

  const resolveLevel =
    options.resolve === undefined
      ? (category: string): LevelEntry => resolveEntry(settings.levels, category) ?? FALLBACK_ENTRY
      : options.resolve.bind(options);

  function resolve(category: string): LevelEntry {
    if (!settled) {
      settle();
    }
    return resolveLevel(category);
  }

  let resource: () => Resource;
  if (options.resource === undefined) {
    const fixed = emptyResource();
    resource = () => fixed;
  } else {
    resource = options.resource.bind(options);
  }

  /** The sources already reported in the configuration in force, read only under `sinkErrorsOncePerSource`. */
  let reported = new WeakSet<Sink | LogProcessor>();

  let onSinkError: (error: unknown, source: Sink | LogProcessor) => void;
  if (options.onSinkError === undefined) {
    onSinkError = () => {};
  } else if (options.sinkErrorsOncePerSource === true) {
    const report = options.onSinkError.bind(options);
    onSinkError = (error, source) => {
      if (reported.has(source)) {
        return;
      }
      reported.add(source);
      report(error, source);
    };
  } else {
    onSinkError = options.onSinkError.bind(options);
  }

  let emitSettings = emitSettingsOf(settings);

  /** What the provider's Loggers emit through under `current`; it cannot throw, so it never splits a commit. */
  function emitSettingsOf(current: LoggingSettings): EmitSettings {
    return Object.freeze({
      sinks: current.sinks,
      processors: current.processors,
      clock: current.clock,
      redaction: current.redaction,
      resource,
      onSinkError,
    });
  }

  function emit(): EmitSettings {
    return emitSettings;
  }

  /** The raw environment spec, `""` when there is none to read, it is not a string or the read throws. */
  function readRawEnvironment(): string {
    if (options.environment === undefined) {
      return "";
    }
    try {
      const raw = options.environment();
      return typeof raw === "string" ? raw : "";
    } catch {
      return "";
    }
  }

  /** The environment layer, read and parsed on the first call and cached for the provider's life. Never throws. */
  function readEnvironment(): LevelLayer {
    if (environment === undefined) {
      const parsed = parseEnvironmentSpec(readRawEnvironment());
      environment = freezeLayer(parsed.levels);
      environmentIssues = parsed.issues;
    }
    return environment;
  }

  /** The environment layer of a configuration whose build does or does not ignore it. */
  function environmentFor(ignore: boolean): LevelLayer {
    return ignore ? EMPTY_LAYER : readEnvironment();
  }

  /** Reports the environment spec's issues once, after the read; a throwing `onIssues` is swallowed. */
  function reportEnvironmentIssues(): void {
    const issues = environmentIssues;
    if (issues.length === 0) {
      return;
    }
    environmentIssues = [];
    try {
      options.onIssues?.(issues);
    } catch {
      // The read can happen inside a Logger's level check, and a Logger call never throws.
    }
  }

  /** The configuration in force, with the environment layer brought in. */
  function current(): LoggingSettings {
    if (!settled) {
      settle();
    }
    return settings;
  }

  /** Commits `overrides` as the overrides layer over the rest of the configuration in force. */
  function setOverrides(overrides: Readonly<Record<string, Threshold>>): LoggingSettings {
    const next = commit(createSettings({ ...settings.layers, overrides, environment: environmentFor(ignoring) }, settings));
    reportEnvironmentIssues();
    return next;
  }

  const warnLine = options.warn === undefined ? (message: string) => console.warn(message) : options.warn.bind(options);

  /**
   * The console handle's write path: one `info` record under {@link CONSOLE_HANDLE_CATEGORY} through
   * the sinks in force, with no level check, so the category's own level never suppresses it; with
   * no sink, one line to the warn hook.
   */
  function confirm(message: string): void {
    if (emitSettings.sinks.length === 0) {
      warnLine(message);
    } else {
      emitRecord(emitSettings, "info", CONSOLE_HANDLE_CATEGORY, message, undefined, undefined);
    }
  }

  function apply(next: LoggingSettings): void {
    settings = next;
    emitSettings = emitSettingsOf(next);
  }

  function commit(next: LoggingSettings): LoggingSettings {
    settled = true;
    apply(next);
    options.publish?.(next);
    return next;
  }

  /**
   * Brings the environment layer into the configuration in force when a Logger's level check comes
   * before any `configure`, `override` or `reset`, publishing the result when the layer holds a
   * level. Runs inside a Logger call, so it never throws: a throwing `publish` leaves the layer in
   * force, unpublished.
   */
  function settle(): void {
    settled = true;
    const layer = environmentFor(ignoring);
    if (Object.keys(layer).length > 0) {
      try {
        commit(createSettings({ ...settings.layers, environment: layer }, settings));
      } catch {
        // `apply` has run; only `publish` can have thrown.
      }
    }
    reportEnvironmentIssues();
  }

  /** Runs `callback` on a fresh builder and builds it, so a throw leaves `settings` as it was. */
  function buildOf(callback: ConfigureCallback): LoggingBuild {
    const builder = createLoggingBuilder();
    callback(builder);
    return builder.build();
  }

  function reportIssues(issues: readonly string[]): void {
    if (issues.length > 0) {
      options.onIssues?.(issues);
    }
  }

  // The starting configuration is committed once `apply` has run: a provider publishes nothing it
  // starts with, so being in force is the whole commit, and an unreadable stored spec is removed
  // only past that point, as `configure` removes one only past its own commit.
  if (configure !== undefined) {
    const build = buildOf(configure);
    apply(createSettings({ defaults: build.defaults, builder: build.builder, overrides: EMPTY_LAYER, environment: EMPTY_LAYER }, build));
    ignoring = build.ignoreEnvironment;
    clearUnreadableStoredSpecs(build);
    reportIssues(build.issues);
  }

  return Object.freeze({
    configure(callback: ConfigureCallback): LoggingSettings {
      const build = buildOf(callback);
      const next = createSettings(
        {
          defaults: build.defaults,
          builder: build.builder,
          overrides: settings.layers.overrides,
          environment: environmentFor(build.ignoreEnvironment),
        },
        build,
      );
      ignoring = build.ignoreEnvironment;
      reported = new WeakSet();
      commit(next);
      // Committed: in force and published. A throwing `build` or `publish` never gets here.
      clearUnreadableStoredSpecs(build);
      reportEnvironmentIssues();
      reportIssues(build.issues);
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
      return setOverrides(overrides);
    },
    reset(): LoggingSettings {
      reported = new WeakSet();
      ignoring = false;
      const next = commit(
        createSettings({ defaults: DEFAULT_LEVELS, builder: EMPTY_LAYER, overrides: EMPTY_LAYER, environment: environmentFor(false) }),
      );
      reportEnvironmentIssues();
      return next;
    },
    logger(category: string): Logger {
      return createLogger(category, resolve, emit);
    },
    installConsole(name: string): () => void {
      return installConsoleHandle(name, { settings: current, setOverrides, confirm });
    },
  });
}
