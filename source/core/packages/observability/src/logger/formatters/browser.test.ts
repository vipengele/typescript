import type { Level, SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, test } from "vitest";
import type { LogRecord } from "../record";
import { browserFormatter } from "./browser";

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

const LEVELS: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];

/** The directives of a console format string, in order, with `%%` read as a literal `%`. */
function directives(format: string): string[] {
  return [...format.matchAll(/%(.)/gs)].map((match) => match[1] as string).filter((directive) => directive !== "%");
}

/** The text a console prints for `format` once every `%%` is a literal and every `%c` is consumed. */
function printed(format: string): string {
  return format.replaceAll(/%(.)/gs, (_match, directive: string) => (directive === "%" ? "%" : ""));
}

describe("browserFormatter", () => {
  test("returns the %c format string, its three styles, then the message", () => {
    expect(browserFormatter.format(RECORD, RESOURCE)).toEqual([
      "%c2025-10-09T08:53:20.123Z %cINFO %capp.checkout",
      "color: grey",
      "color: green",
      "font-weight: bold",
      "order placed",
    ]);
  });

  test("passes exactly one CSS string for each %c directive", () => {
    for (const level of LEVELS) {
      const [format, ...rest] = browserFormatter.format({ ...RECORD, level }, RESOURCE);
      expect(directives(format as string)).toEqual(["c", "c", "c"]);
      expect(rest.slice(0, 3).every((style) => typeof style === "string")).toBe(true);
      expect(rest[3]).toBe("order placed");
    }
  });

  test("writes each level upper-cased in a style of its own", () => {
    const styles = LEVELS.map((level) => {
      const args = browserFormatter.format({ ...RECORD, level }, RESOURCE);
      expect(printed(args[0] as string)).toBe(`2025-10-09T08:53:20.123Z ${level.toUpperCase()} app.checkout`);
      return args[2];
    });
    expect(new Set(styles).size).toBe(LEVELS.length);
  });

  test("passes the attribute object itself, not a string", () => {
    const attributes = Object.freeze({ orderId: "o-1", total: 42 });
    const args = browserFormatter.format({ ...RECORD, attributes }, RESOURCE);
    expect(args).toHaveLength(6);
    expect(args[5]).toBe(attributes);
  });

  test("leaves the attributes argument out when there are none", () => {
    expect(browserFormatter.format(RECORD, RESOURCE)).toHaveLength(5);
  });

  test("passes the serialized error last, after the attributes", () => {
    const error: SerializedError = { type: "Error", message: "boom", cause: { type: "TypeError", message: "inner" } };
    const attributes = Object.freeze({ orderId: "o-1" });
    const args = browserFormatter.format({ ...RECORD, level: "error", attributes, error }, RESOURCE);
    expect(args).toHaveLength(7);
    expect(args[5]).toBe(attributes);
    expect(args[6]).toBe(error);
  });

  test("passes the serialized error straight after the message when there are no attributes", () => {
    const error: SerializedError = { type: "Error", message: "boom" };
    const args = browserFormatter.format({ ...RECORD, level: "error", error }, RESOURCE);
    expect(args).toHaveLength(6);
    expect(args[5]).toBe(error);
    expect(args).not.toContain(undefined);
  });

  test.each(["50%d", "a%cb", "%s", "100%", "%%", "%d %c %s %"])(
    "escapes the percent signs of the category %s, so the styles stay aligned",
    (category) => {
      const [format, ...rest] = browserFormatter.format({ ...RECORD, category }, RESOURCE);
      expect(format).toContain(category.replaceAll("%", "%%"));
      expect(directives(format as string)).toEqual(["c", "c", "c"]);
      expect(printed(format as string)).toBe(`2025-10-09T08:53:20.123Z INFO ${category}`);
      expect(rest).toHaveLength(4);
    },
  );

  test("passes the message and attribute values unchanged, outside the format string", () => {
    const attributes = Object.freeze({ note: "%d %c %s %" });
    const args = browserFormatter.format({ ...RECORD, message: "disk 95%d full %c %s %", attributes }, RESOURCE);
    expect(args[4]).toBe("disk 95%d full %c %s %");
    expect(args[5]).toBe(attributes);
    expect(directives(args[0] as string)).toEqual(["c", "c", "c"]);
  });
});
