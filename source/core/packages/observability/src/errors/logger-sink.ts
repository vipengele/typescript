import { isLevel, type Level, SEVERITY_NUMBERS } from "@vipengele/ts-core-common";
import type { LogRecord, Sink } from "../logger/record";
import type { Mechanism } from "./event";
import type { Capture } from "./pipeline";
import { ReporterConfigError } from "./reporter-config-error";

/** What {@link Reporter.loggerSink} accepts. */
export interface LoggerSinkOptions {
  /** The lowest level a record carrying an error is reported at; `"error"` by default. */
  readonly minLevel?: Level;
}

/** A Log Record's error, handed over by the logger rather than caught by the application. */
const LOGGED: Mechanism = { handled: true, source: "logger" };

function describe(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : `of type ${value === null ? "null" : typeof value}`;
}

/**
 * A logger {@link Sink} that reports every record carrying an `error` at `minLevel` or above
 * through `capture`, the record's category and message riding along as the `logger.category` and
 * `logger.message` attributes and its trace standing in for the span active at capture. A record
 * without an error, or below `minLevel`, is ignored.
 *
 * A `write` made while this sink's own capture is still on the stack — a transport or processor
 * logging back through the same logger — is dropped, so a record can never report itself
 * recursively. `write` never throws.
 *
 * @throws {ReporterConfigError} When `minLevel` is given and is not a level.
 */
export function createLoggerSink(capture: Capture, options?: LoggerSinkOptions): Sink {
  const minLevel = options?.minLevel === undefined ? "error" : options.minLevel;
  if (!isLevel(minLevel)) {
    throw new ReporterConfigError(`Invalid reporter logger sink minimum level ${describe(minLevel)}: expected a level.`);
  }
  const threshold = SEVERITY_NUMBERS[minLevel];
  let capturing = false;

  return {
    write(record: LogRecord) {
      if (capturing || record.error === undefined || SEVERITY_NUMBERS[record.level] < threshold) {
        return;
      }
      capturing = true;
      try {
        capture(
          {
            kind: "serialized-exception",
            error: record.error,
            level: record.level,
            attributes: { ...record.attributes, "logger.category": record.category, "logger.message": record.message },
            trace: record.trace,
          },
          { ...LOGGED },
        );
      } finally {
        capturing = false;
      }
    },
  };
}
