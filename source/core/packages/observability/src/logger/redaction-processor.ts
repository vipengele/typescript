import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { redactAttributes, redactError } from "../redaction";
import type { LogProcessor, LogRecord } from "./record";

/**
 * A processor that redacts a record's `attributes` and every link of its `error` chain under
 * `policy` (the `secretKeys` preset by default), for a sink that needs more than the builder's
 * `redaction` already applied. It returns a new record and leaves its input as it is. The
 * `message` is not scanned, as with built-in redaction, and the pass runs unbounded because the
 * record's attributes and error are bounded already.
 */
export function redactionProcessor(policy: RedactionPolicy = secretKeys): LogProcessor {
  return (record) => {
    const redacted: { -readonly [K in keyof LogRecord]: LogRecord[K] } = {
      ...record,
      attributes: redactAttributes(record.attributes, policy),
    };
    if (record.error !== undefined) {
      redacted.error = redactError(record.error, policy);
    }
    return redacted;
  };
}
