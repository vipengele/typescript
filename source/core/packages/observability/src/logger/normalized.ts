import type { LogRecord } from "./record";

/**
 * Records the emit path built or accepted itself: deeply frozen, with JSON-safe, bounded attributes
 * and error chain. Membership is by identity, so a copy of a marked record — a processor spreading
 * it to change a field — is not marked and is normalized in full.
 *
 * The set belongs to this module copy, not to a `globalThis` slot: a record marked by another
 * resolved copy of the package is unmarked here and takes the full normalization, which is always
 * safe.
 */
const normalized = new WeakSet<LogRecord>();

/** Marks `record`, which must already be deeply frozen and hold only normalized parts, and returns it. */
export function markNormalized<T extends LogRecord>(record: T): T {
  normalized.add(record);
  return record;
}

/** Whether `value` is a record {@link markNormalized} marked. */
export function isNormalized(value: unknown): value is LogRecord {
  // `WeakSet#has` answers `false` for a primitive rather than throwing.
  return normalized.has(value as LogRecord);
}
