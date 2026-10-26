import type { Attributes, Level } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { governingKeys, validateCategory } from "./categories";
import type { LogRecord, Sink } from "./record";

/** What {@link TestSink.find} selects records by. Every field given must match; an empty object matches every record. */
export interface FindCriteria {
  /** The record's level, compared exactly: `"warn"` never matches an `"error"` record. */
  readonly level?: Level;
  /**
   * A Category the record's category equals or sits under, at a `.` boundary and case-sensitively:
   * `app.db` matches `app.db` and `app.db.pool`, never `app.dbx` or `App.db`. A value that is not a
   * Category, the root `*` included, makes `find` throw a `LoggingConfigError`.
   */
  readonly category?: string;
  /**
   * The record's message: a string matches it exactly, a RegExp matches when it tests true. The
   * RegExp's `lastIndex` is reset before each record, so a `g` or `y` flag never skips a match.
   */
  readonly message?: string | RegExp;
  /**
   * A subset of the record's attributes: each key given must be present on the record with a
   * value `===` to the one given. A nested object or array never matches, since a record carries
   * its own normalized copy of every attribute value.
   */
  readonly attributes?: Attributes;
}

/** A {@link Sink} that records every Log Record it is written, and the Resource written with it, instead of delivering it anywhere. */
export interface TestSink extends Sink {
  /** Every record written so far, oldest first. */
  readonly records: LogRecord[];
  /** The Resource each record in {@link TestSink.records} was written with, at the same index. */
  readonly resources: Resource[];
  /** Empties {@link TestSink.records} and {@link TestSink.resources} in place, so a held reference to either sees them empty. */
  clear(): void;
  /** The records matching every field of `criteria`, oldest first, in a new array. */
  find(criteria: FindCriteria): LogRecord[];
}

/** Creates a {@link TestSink} for asserting what a logger emitted, without a console. */
export function createTestSink(): TestSink {
  const records: LogRecord[] = [];
  const resources: Resource[] = [];

  return {
    records,
    resources,
    clear() {
      records.length = 0;
      resources.length = 0;
    },
    find(criteria) {
      const category = criteria.category === undefined ? undefined : validateCategory(criteria.category);
      return records.filter(
        (record) =>
          (criteria.level === undefined || record.level === criteria.level) &&
          (category === undefined || underCategory(record.category, category)) &&
          (criteria.message === undefined || messageMatches(record.message, criteria.message)) &&
          (criteria.attributes === undefined || attributesMatch(record.attributes, criteria.attributes)),
      );
    },
    write(record, resource) {
      records.push(record);
      resources.push(resource);
    },
  };
}

function underCategory(recordCategory: string, category: string): boolean {
  for (const key of governingKeys(recordCategory)) {
    if (key === category) {
      return true;
    }
  }
  return false;
}

function messageMatches(message: string, expected: string | RegExp): boolean {
  if (typeof expected === "string") {
    return message === expected;
  }
  expected.lastIndex = 0;
  return expected.test(message);
}

function attributesMatch(actual: Attributes, expected: Attributes): boolean {
  return Object.keys(expected).every((key) => actual[key] === expected[key]);
}
