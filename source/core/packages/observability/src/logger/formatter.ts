import type { Level } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import type { LogRecord } from "./record";

/**
 * Turns a {@link LogRecord} into the argument list of one console call. The console sink owns
 * level-to-method routing, so a formatter never picks the method. The first argument is a console
 * format string, so a formatter returns user text only behind a `"%s"` or with `%` escaped.
 */
export interface Formatter {
  format(record: LogRecord, resource: Resource): readonly unknown[];
}

/** The subset of the `console` global a console sink writes to. */
export interface ConsoleLike {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/**
 * Level to console method (ADR-0007 "Levels"): `error` and `fatal` to `error`, `warn` to `warn`,
 * `info` to `info`, `trace` and `debug` to `debug`, so DevTools' Verbose filter separates them from
 * `info`. `console.trace` is never used, since it prints a stack on every call. The logger keeps
 * its own copy of this table because the `./logger` and `./errors` entry points do not import each
 * other.
 */
const CONSOLE_METHODS: Readonly<Record<Level, keyof ConsoleLike>> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
};

/** The console method a record at `level` is written with. */
export function consoleMethodFor(level: Level): keyof ConsoleLike {
  return CONSOLE_METHODS[level];
}
