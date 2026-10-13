import type { Level, SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, test } from "vitest";
import type { LogRecord } from "../record";
import { ansiFormatter } from "./ansi";

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": "1.2.3",
  "service.dist": undefined,
  "deployment.environment.name": "production",
  "process.runtime.name": undefined,
  "process.runtime.version": undefined,
  "os.type": undefined,
  "os.version": undefined,
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
});

const RECORD: LogRecord = Object.freeze({
  time: 1_760_000_000_123.456,
  level: "info",
  category: "app.checkout",
  message: "order placed",
  attributes: Object.freeze({}),
});

const ESC = "\u001b[";
const RESET = `${ESC}0m`;

/** `text` behind the SGR sequence `code`, followed by a reset. */
function sgr(code: string, text: string): string {
  return `${ESC}${code}m${text}${RESET}`;
}

/** A raw ESC and BEL, and the `\uXXXX` escapes the formatter shows them as. */
const RAW_ESC = "\u001b";
const RAW_BEL = "\u0007";
const SHOWN_ESC = "\\u001b";
const SHOWN_BEL = "\\u0007";

const TIME = sgr("2", "2025-10-09T08:53:20.123Z");
const CATEGORY = sgr("1", "app.checkout");
const INFO = sgr("32", "INFO ");

/** The formatter's output for `record`, asserted to be `["%s", line]`. */
function formatted(record: LogRecord): string {
  const args = ansiFormatter.format(record, RESOURCE);
  expect(args).toHaveLength(2);
  expect(args[0]).toBe("%s");
  expect(typeof args[1]).toBe("string");
  return args[1] as string;
}

/**
 * The text outside every styled segment. Asserts that each reset closes exactly one segment that
 * opened with one escape sequence, so no style runs on past its own segment.
 */
function unstyled(line: string): string {
  const pieces = line.split(RESET);
  const rest = pieces.at(-1) as string;
  const outside = pieces.slice(0, -1).map((piece) => {
    expect(piece.split(ESC)).toHaveLength(2);
    return piece.slice(0, piece.indexOf(ESC));
  });
  return [...outside, rest].join("");
}

/** The SGR sequence the level label of `line` opens with. */
function levelStyle(line: string): string {
  const label = line.slice(TIME.length + 1);
  return label.slice(0, label.indexOf("m") + 1);
}

describe("ansiFormatter", () => {
  test("writes a dim UTC time, a coloured level, a bold category and the message", () => {
    expect(formatted(RECORD)).toBe(`${TIME} ${INFO} ${CATEGORY} order placed`);
    expect(formatted(RECORD)).toBe(
      // biome-ignore lint/security/noSecrets: a golden line of escape sequences, flagged only for its entropy
      "\u001b[2m2025-10-09T08:53:20.123Z\u001b[0m \u001b[32mINFO \u001b[0m \u001b[1mapp.checkout\u001b[0m order placed",
    );
  });

  test.each<[Level, string]>([
    ["trace", sgr("90", "TRACE")],
    ["debug", sgr("36", "DEBUG")],
    ["info", sgr("32", "INFO ")],
    ["warn", sgr("33", "WARN ")],
    ["error", sgr("31", "ERROR")],
    ["fatal", sgr("1;97;41", "FATAL")],
  ])("writes the %s label in its own colour", (level, label) => {
    expect(formatted({ ...RECORD, level })).toBe(`${TIME} ${label} ${CATEGORY} order placed`);
  });

  test("gives every level a distinct colour", () => {
    const levels: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];
    const styles = levels.map((level) => levelStyle(formatted({ ...RECORD, level })));

    expect(new Set(styles).size).toBe(levels.length);
  });

  test("renders the time as UTC ISO 8601 text, dropping the sub-millisecond fraction", () => {
    expect(formatted({ ...RECORD, time: 0.999 })).toContain(`${sgr("2", "1970-01-01T00:00:00.000Z")} `);
  });

  test("appends the attributes as one compact JSON object in their key order", () => {
    const attributes = Object.freeze({ orderId: "o-1", items: 3, paid: true, tags: ["a", "b"], nested: { at: null } });

    expect(formatted({ ...RECORD, attributes })).toBe(
      `${TIME} ${INFO} ${CATEGORY} order placed {"orderId":"o-1","items":3,"paid":true,"tags":["a","b"],"nested":{"at":null}}`,
    );
  });

  test("leaves the attributes segment out when there are none", () => {
    expect(formatted(RECORD).endsWith("order placed")).toBe(true);
  });

  test("renders an error with its stack frames and cause chain on the following lines", () => {
    const error: SerializedError = {
      type: "Error",
      message: "checkout failed",
      code: "checkout.failed",
      data: { attempt: 2 },
      stack: "Error: checkout failed\n    at pay (pay.ts:1:1)\n    at run (run.ts:2:2)",
      cause: {
        type: "TypeError",
        message: "gateway timeout",
        stack: "pay@pay.ts:1:1",
        cause: { type: "[Truncated]", message: "the chain continues past 5 links" },
      },
    };

    expect(formatted({ ...RECORD, level: "error", error })).toBe(
      [
        `${TIME} ${sgr("31", "ERROR")} ${CATEGORY} order placed`,
        '  Error: checkout failed [checkout.failed] {"attempt":2}',
        "      at pay (pay.ts:1:1)",
        "      at run (run.ts:2:2)",
        "    Caused by: TypeError: gateway timeout",
        "    pay@pay.ts:1:1",
        "      Caused by: [Truncated]: the chain continues past 5 links",
      ].join("\n"),
    );
  });

  test("renders each entry of an errors array beneath its aggregate", () => {
    const error: SerializedError = {
      type: "AggregateError",
      message: "all failed",
      errors: [
        { type: "TypeError", message: "card declined", cause: { type: "[Circular]", message: "an error already on this chain" } },
        { type: "Error", message: "42", synthetic: true },
      ],
    };

    expect(formatted({ ...RECORD, attributes: { orderId: "o-1" }, error })).toBe(
      [
        `${TIME} ${INFO} ${CATEGORY} order placed {"orderId":"o-1"}`,
        "  AggregateError: all failed",
        "    errors[0]: TypeError: card declined",
        "      Caused by: [Circular]: an error already on this chain",
        "    errors[1]: Error: 42",
      ].join("\n"),
    );
  });

  test("indents every line of a multi-line error message", () => {
    const error: SerializedError = { type: "Error", message: "first\nsecond" };

    const lines = formatted({ ...RECORD, error }).split("\n");

    expect(lines.slice(1)).toEqual(["  Error: first", "  second"]);
  });

  test("ends every styled segment in a reset, so no style reaches the message, attributes or error", () => {
    const error: SerializedError = { type: "Error", message: "boom", cause: { type: "Error", message: "inner" } };
    const levels: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];

    for (const level of levels) {
      const line = formatted({ ...RECORD, level, attributes: { key: "value" }, error });
      const rest = unstyled(line);

      expect(rest).not.toContain(ESC);
      expect(rest).toBe('   order placed {"key":"value"}\n  Error: boom\n    Caused by: Error: inner');
      expect(line.split(ESC).length - 1).toBe(6);
      expect(line.split(RESET).length - 1).toBe(3);
    }
  });

  test("shows an OSC sequence in the message as visible escapes, leaving only the formatter's own ESC", () => {
    const line = formatted({ ...RECORD, message: "title \u001b]0;pwn\u0007 set" });

    expect(line).toBe(`${TIME} ${INFO} ${CATEGORY} title \\u001b]0;pwn\\u0007 set`);
    expect(line.split("\u001b").length - 1).toBe(6);
    expect(unstyled(line)).not.toContain("\u001b");
  });

  test("shows ESC in the category and in an error's type, message, code and stack as visible escapes", () => {
    const error: SerializedError = {
      type: `Error${RAW_ESC}[2J`,
      message: `bad input ${RAW_ESC}[31mred`,
      code: `code${RAW_ESC}[K`,
      stack: `frame ${RAW_ESC}]8;;https://example.test${RAW_BEL}link`,
    };

    const line = formatted({ ...RECORD, category: `app${RAW_ESC}[1Achk`, error });

    expect(line).toBe(
      [
        `${TIME} ${INFO} ${sgr("1", `app${SHOWN_ESC}[1Achk`)} order placed`,
        `  Error${SHOWN_ESC}[2J: bad input ${SHOWN_ESC}[31mred [code${SHOWN_ESC}[K]`,
        `  frame ${SHOWN_ESC}]8;;https://example.test${SHOWN_BEL}link`,
      ].join("\n"),
    );
    expect(line.split("\u001b").length - 1).toBe(6);
  });

  test("strips the V8 stack header before escaping the remaining frames", () => {
    const error: SerializedError = {
      type: "Error",
      message: "bad \u001b",
      stack: "Error: bad \u001b\n    at run (run\u001b.ts:1:1)",
    };

    expect(
      formatted({ ...RECORD, error })
        .split("\n")
        .slice(1),
    ).toEqual(["  Error: bad \\u001b", "      at run (run\\u001b.ts:1:1)"]);
  });

  test("indents every message line after the first, so a newline cannot forge a record", () => {
    const line = formatted({ ...RECORD, message: "ok\r\n2025-01-01T00:00:00.000Z INFO  fake forged" });

    expect(line).toBe(`${TIME} ${INFO} ${CATEGORY} ok\\u000d\n  2025-01-01T00:00:00.000Z INFO  fake forged`);
    for (const continuation of line.split("\n").slice(1)) {
      expect(continuation.startsWith(" ")).toBe(true);
    }
  });

  test("indents every category line after the first", () => {
    expect(formatted({ ...RECORD, category: "app\nforged" })).toBe(`${TIME} ${INFO} ${sgr("1", "app\n  forged")} order placed`);
  });

  test("keeps tabs and newlines, indenting the line after a newline", () => {
    expect(formatted({ ...RECORD, message: "a\tb\nc\td" })).toBe(`${TIME} ${INFO} ${CATEGORY} a\tb\n  c\td`);
  });

  test("shows NUL, DEL and C1 controls as visible escapes and keeps other non-ASCII text", () => {
    const line = formatted({ ...RECORD, message: "\u0000 \u007f \u0080 \u009b31m \u009f \u00a0é 😀 ~" });

    expect(line).toBe(`${TIME} ${INFO} ${CATEGORY} \\u0000 \\u007f \\u0080 \\u009b31m \\u009f \u00a0é 😀 ~`);
  });

  test("keeps format specifiers in the message, category and attributes intact behind %s", () => {
    const text = "disk 95%d full, %c styled, %s swallowed, 100% bare %";
    const record: LogRecord = {
      ...RECORD,
      category: "app.%d.%c.%s.%",
      message: text,
      attributes: { note: text, "%s": "%d", nested: { value: "%c%" } },
      error: { type: "Error", message: "%d %c %s %" },
    };
    const args = ansiFormatter.format(record, RESOURCE);

    expect(args[0]).toBe("%s");
    expect(args[1]).toBe(
      [
        `${TIME} ${INFO} ${sgr("1", "app.%d.%c.%s.%")} ${text} {"note":"${text}","%s":"%d","nested":{"value":"%c%"}}`,
        "  Error: %d %c %s %",
      ].join("\n"),
    );
  });
});
