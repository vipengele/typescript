import type { Resource } from "@vipengele/ts-core-common/scope";
import type { Formatter } from "../formatter";
import type { LogRecord } from "../record";

/**
 * Copies the Resource's keys into a plain object. `JSON.stringify` reads own enumerable properties
 * only, so a Resource whose values sit behind prototype getters would otherwise serialize as `{}`.
 * A key with no value is `undefined` here and absent from the line.
 */
function plainResource(resource: Resource): Resource {
  return {
    "service.name": resource["service.name"],
    "service.version": resource["service.version"],
    "service.dist": resource["service.dist"],
    "deployment.environment.name": resource["deployment.environment.name"],
    "process.runtime.name": resource["process.runtime.name"],
    "process.runtime.version": resource["process.runtime.version"],
    "os.type": resource["os.type"],
    "os.version": resource["os.version"],
    "browser.name": resource["browser.name"],
    "browser.version": resource["browser.version"],
    "device.type": resource["device.type"],
  };
}

/**
 * Formats a record as one JSON object on one line, keyed `time`, `level`, `category`, `message`,
 * `attributes`, `error`, `trace_id`, `span_id`, `resource` in that order; `error` is absent when the
 * record has none, and `trace_id` and `span_id` are absent when it carries no trace. The trace flags
 * are not written. Attributes sit under their own `attributes` key, so none can collide with the
 * top-level keys.
 * `time` is the record's epoch milliseconds as a number, sub-millisecond fraction included, so
 * records written within one millisecond stay ordered (ADR-0007). The line carries no trailing
 * newline, which the console adds. It is returned behind `"%s"`, so a `%` in user text never
 * reaches the console's format string.
 */
export const jsonLinesFormatter: Formatter = {
  format(record: LogRecord, resource: Resource): readonly unknown[] {
    const line = JSON.stringify({
      time: record.time,
      level: record.level,
      category: record.category,
      message: record.message,
      attributes: record.attributes,
      error: record.error,
      trace_id: record.trace?.traceId,
      span_id: record.trace?.spanId,
      resource: plainResource(resource),
    });
    return ["%s", line];
  },
};
