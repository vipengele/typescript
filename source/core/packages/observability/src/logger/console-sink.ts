import type { RuntimeSource } from "@vipengele/ts-core-common/runtime";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { type ConsoleLike, consoleMethodFor, type Formatter } from "./formatter";
import { selectConsoleFormatter } from "./formatters/select";
import type { LogRecord, Sink } from "./record";

/** How a console sink formats records and which console it writes them to. */
export interface ConsoleSinkOptions {
  /** The formatter every record goes through. Without one, the runtime's capabilities pick it. */
  readonly formatter?: Formatter;
  /** The console written to. Without one, `globalThis.console` is read on every write. */
  readonly console?: ConsoleLike;
  /** Where capabilities are read when no `formatter` is given; `globalThis` when omitted. */
  readonly source?: RuntimeSource;
}

/**
 * A {@link Sink} that writes each record to a console, with one call whose arguments are the
 * formatter's output, spread in order. The method follows the record's level: `error` and `fatal`
 * to `error`, `warn` to `warn`, `info` to `info`, `trace` and `debug` to `debug`.
 *
 * The formatter is `options.formatter`, or the one the runtime's capabilities select from
 * `options.source`, resolved once when the sink is created; a capability that changes later does
 * not switch it. The console is `options.console`, or `globalThis.console` read at each write, so
 * a console replaced after creation is the one written to.
 *
 * `write` catches nothing: a throwing formatter or console method propagates to the provider,
 * which reports it through `onSinkError` and never to the caller of the Logger.
 */
export function createConsoleSink(options: ConsoleSinkOptions = {}): Sink {
  const formatter = options.formatter ?? selectConsoleFormatter(options.source);
  const injected = options.console;
  return {
    write(record: LogRecord, resource: Resource): void {
      const target: ConsoleLike = injected ?? globalThis.console;
      target[consoleMethodFor(record.level)](...formatter.format(record, resource));
    },
  };
}
