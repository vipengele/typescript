import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";

/** The subset of the `console` global a {@link createConsoleTransport} writes to. */
export interface ConsoleLike {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface ConsoleTransportOptions {
  /** Defaults to `globalThis.console`. */
  console?: ConsoleLike;
}

/**
 * Creates a {@link Transport} that writes each event to `options.console` (default
 * `globalThis.console`). `error` and `fatal` go to `console.error`, `warn` to `console.warn`,
 * `info` to `console.info`, and `trace` and `debug` to `console.debug` — never `console.trace`,
 * which prints a stack on every call (ADR-0007, "Levels").
 */
export function createConsoleTransport(options: ConsoleTransportOptions = {}): Transport {
  const target = options.console ?? globalThis.console;
  let closed = false;

  return {
    send(event) {
      if (closed) {
        return;
      }
      target[methodFor(event.level)](event);
    },
    async flush() {
      return true;
    },
    async close() {
      closed = true;
      return true;
    },
  };
}

function methodFor(level: ErrorEvent["level"]): keyof ConsoleLike {
  switch (level) {
    case "error":
    case "fatal":
      return "error";
    case "warn":
      return "warn";
    case "info":
      return "info";
    case "debug":
    case "trace":
      return "debug";
  }
}
