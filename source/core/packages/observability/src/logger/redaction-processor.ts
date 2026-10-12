import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { redactAttributes, redactError } from "../redaction";
import { freezeDeep } from "./emit";
import { isNormalized, markNormalized } from "./normalized";
import type { LogProcessor, LogRecord } from "./record";

/**
 * A processor that redacts a record's `attributes` and every link of its `error` chain under
 * `policy` (the `secretKeys` preset by default), for a sink that needs more than the builder's
 * `redaction` already applied. It returns a new record and leaves its input as it is. The
 * `message` is not scanned, as with built-in redaction, and the pass runs unbounded because the
 * record's attributes and error are bounded already.
 *
 * Redacting a normalized record yields a normalized one, as the built-in redaction stage does, so
 * when the input is a record the emit path marked, the output is deeply frozen and marked too, and
 * the emit path takes it without normalizing it a second time. Any other input — a record a
 * processor built or copied — leaves the output unfrozen and unmarked, and the emit path normalizes
 * it in full.
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
    // Freezing before marking keeps a processor that calls this one from changing the marked
    // record before returning it.
    return isNormalized(record) ? markNormalized(freezeDeep(redacted)) : redacted;
  };
}
