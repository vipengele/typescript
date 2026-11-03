import type { SerializedError } from "@vipengele/ts-core-common";
import { describe, expect, test } from "vitest";
import { EXCEPTION_KEYS, exceptionAttributes, exceptionStacktrace } from "./exception";

describe("exceptionAttributes", () => {
  test("writes the outermost type and message and the whole chain as the stacktrace", () => {
    const error: SerializedError = {
      type: "Error",
      message: "outer",
      stack: "Error: outer\n    at f (a.js:1:1)",
      cause: { type: "RangeError", message: "inner" },
    };

    expect(exceptionAttributes(error)).toEqual([
      { key: "exception.type", value: { stringValue: "Error" } },
      { key: "exception.message", value: { stringValue: "outer" } },
      { key: "exception.stacktrace", value: { stringValue: "Error: outer\n    at f (a.js:1:1)\nCaused by: RangeError: inner" } },
    ]);
  });

  test("writes exactly the keys EXCEPTION_KEYS holds", () => {
    const keys = exceptionAttributes({ type: "Error", message: "x" }).map(({ key }) => key);

    expect(new Set(keys)).toEqual(EXCEPTION_KEYS);
  });
});

describe("exceptionStacktrace", () => {
  test("replaces a V8 stack's own header with the error's, keeping its frames", () => {
    const error: SerializedError = {
      type: "CustomError",
      message: "two\nlines",
      stack: "Error: two\nlines\n    at f (a.js:1:1)\n    at g (a.js:2:2)\n",
    };

    expect(exceptionStacktrace(error)).toBe("CustomError: two\nlines\n    at f (a.js:1:1)\n    at g (a.js:2:2)");
  });

  test("keeps a header-less stack whole", () => {
    const error: SerializedError = { type: "Error", message: "x", stack: "f@a.js:1:1\ng@a.js:2:2\n" };

    expect(exceptionStacktrace(error)).toBe("Error: x\nf@a.js:1:1\ng@a.js:2:2");
  });

  test("drops a frameless stack that is only the header", () => {
    expect(exceptionStacktrace({ type: "Error", message: "x", stack: "Error: x" })).toBe("Error: x");
  });

  test("writes the type alone for an empty message and a header alone without a stack", () => {
    expect(exceptionStacktrace({ type: "Error", message: "" })).toBe("Error");
    expect(exceptionStacktrace({ type: "Error", message: '{"a":1}', synthetic: true })).toBe('Error: {"a":1}');
  });

  test("lays out the cause chain in the JVM's Caused by layout", () => {
    const error: SerializedError = {
      type: "Error",
      message: "outer",
      stack: "Error: outer\n    at outer (a.js:1:1)",
      cause: {
        type: "RangeError",
        message: "middle",
        stack: "RangeError: middle\n    at middle (b.js:2:2)",
        cause: { type: "Error", message: "inner" },
      },
    };

    expect(exceptionStacktrace(error)).toBe(
      [
        "Error: outer",
        "    at outer (a.js:1:1)",
        "Caused by: RangeError: middle",
        "    at middle (b.js:2:2)",
        "Caused by: Error: inner",
      ].join("\n"),
    );
  });

  test("writes AggregateError errors as tab-indented Suppressed blocks ahead of the cause", () => {
    const error: SerializedError = {
      type: "AggregateError",
      message: "all failed",
      stack: "AggregateError: all failed\n    at run (a.js:1:1)",
      errors: [
        {
          type: "Error",
          message: "first",
          stack: "Error: first\n    at one (b.js:1:1)",
          cause: { type: "Error", message: "root" },
        },
        { type: "Error", message: "second" },
      ],
      cause: { type: "Error", message: "why" },
    };

    expect(exceptionStacktrace(error)).toBe(
      [
        "AggregateError: all failed",
        "    at run (a.js:1:1)",
        "\tSuppressed: Error: first",
        "\t    at one (b.js:1:1)",
        "\tCaused by: Error: root",
        "\tSuppressed: Error: second",
        "Caused by: Error: why",
      ].join("\n"),
    );
  });
});
