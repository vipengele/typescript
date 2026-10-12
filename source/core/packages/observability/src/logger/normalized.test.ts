import { describe, expect, test } from "vitest";
import { isNormalized, markNormalized } from "./normalized";
import type { LogRecord } from "./record";

function record(): LogRecord {
  return Object.freeze({ time: 1, level: "info", category: "a", message: "m", attributes: Object.freeze({}) });
}

describe("markNormalized", () => {
  test("marks the record it is given and returns it", () => {
    const input = record();
    expect(markNormalized(input)).toBe(input);
    expect(isNormalized(input)).toBe(true);
  });

  test("leaves a copy of a marked record unmarked", () => {
    const marked = markNormalized(record());
    expect(isNormalized({ ...marked })).toBe(false);
  });

  test.each([undefined, null, 1, "record", true])("reads %s as unmarked", (value) => {
    expect(isNormalized(value)).toBe(false);
  });

  test("reads a record it never marked as unmarked", () => {
    expect(isNormalized(record())).toBe(false);
  });
});
