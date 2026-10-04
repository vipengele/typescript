import type { Threshold } from "@vipengele/ts-core-common";
import { Scope } from "@vipengele/ts-core-common/scope";
import type { Logger } from "./logger";
import { type ConfigureCallback, createLoggerProvider, type LoggerProvider } from "./provider";
import type { LoggingSettings } from "./settings";
import { getOrCreateDefaultProvider, publishLevelTable, resolveSharedEntry } from "./slots";

/** Receives one spec issue, as the sentence `parseSpec` wrote for it, or one sentence describing a failed sink write. */
export type WarnTarget = (issue: string) => void;

/**
 * This copy's warn target, `undefined` until one is injected. It is module state, not a shared
 * slot: the target is a function of this copy's host (a test's collector, a host's own channel),
 * and a function cannot be handed to another copy through a slot a different package version
 * reads. A configure call made through another copy's default provider reports through that copy's
 * target.
 */
let warnTarget: WarnTarget | undefined;

/**
 * Redirects where `Logging.configure` reports spec issues and where a failed sink write is
 * reported, or restores `console.warn` when given `undefined`. The target is read when something
 * is reported, never captured, so it governs the default provider whenever that provider was
 * created.
 */
export function setWarnTarget(target: WarnTarget | undefined): void {
  warnTarget = target;
}

function warn(message: string): void {
  if (warnTarget === undefined) {
    console.warn(message);
  } else {
    warnTarget(message);
  }
}

/** Reports each distinct issue of one configure call once, through the current warn target. */
function reportIssues(issues: readonly string[]): void {
  for (const issue of new Set(issues)) {
    warn(issue);
  }
}

/**
 * `error` as text for a sentence: an `Error`'s name and message, anything else through `String`.
 * Never throws: a value whose conversion throws, an object without a prototype say, is described
 * by its type.
 */
function describeThrown(error: unknown): string {
  try {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } catch {
    return `a value of type ${typeof error}`;
  }
}

/** Reports one failed `Sink.write`, every time, through the current warn target. */
function reportSinkError(error: unknown): void {
  warn(`A log sink threw while writing a record: ${describeThrown(error)}`);
}

/**
 * The realm's default provider, created on first use behind the provider slot so importing this
 * module touches nothing on `globalThis`. Its Loggers resolve through the shared levels slot on
 * every call and every change is published to it, which is how copies of the package agree; only
 * the level table is published, never the sinks. Its records carry `Scope.resource()`, and a sink
 * failure is reported through the warn target.
 */
function defaultProvider(): LoggerProvider {
  return getOrCreateDefaultProvider(() =>
    createLoggerProvider(undefined, {
      resolve: resolveSharedEntry,
      publish: (settings) => {
        publishLevelTable(settings.levels);
      },
      onIssues: reportIssues,
      resource: Scope.resource,
      onSinkError: reportSinkError,
    }),
  );
}

/**
 * The logging facade. Its methods act on the default provider shared by every copy of the package
 * in the realm; `createProvider` is the way out of it.
 */
export const Logging = Object.freeze({
  /** A Logger for `category` on the default provider; costs nothing at module scope. */
  logger(category: string): Logger {
    return defaultProvider().logger(category);
  },

  /**
   * Rebuilds the default provider's configuration from `configure`, for every copy of the package.
   * Each distinct spec issue is reported once through the warn target.
   */
  configure(configure: ConfigureCallback): LoggingSettings {
    return defaultProvider().configure(configure);
  },

  /** Sets, or with `null` removes, the override for `category` on the default provider. */
  override(category: string, level: Threshold | null): LoggingSettings {
    return defaultProvider().override(category, level);
  },

  /** Drops the default provider's overrides and builder layer, restoring the defaults. */
  reset(): LoggingSettings {
    return defaultProvider().reset();
  },

  /**
   * A provider of its own, started from the defaults and then `configure`. It reads and writes
   * neither shared slot, and its sinks are its own, shared with neither the default provider nor
   * any other. Its spec issues, from `configure` and from every later `configure` call, are
   * reported once each per call through the warn target, as are its sink failures; its records
   * carry `Scope.resource()`, as the default provider's do.
   */
  createProvider(configure?: ConfigureCallback): LoggerProvider {
    return createLoggerProvider(configure, { onIssues: reportIssues, resource: Scope.resource, onSinkError: reportSinkError });
  },
});
