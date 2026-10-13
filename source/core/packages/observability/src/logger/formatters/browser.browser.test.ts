import type { Resource } from "@vipengele/ts-core-common/scope";
import { afterEach, expect, it, vi } from "vitest";
import type { LogRecord } from "../record";
import { browserFormatter } from "./browser";

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": undefined,
  "service.dist": undefined,
  "deployment.environment.name": undefined,
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
  category: "100%c done",
  message: "disk 95%d full",
  attributes: Object.freeze({ note: "%s" }),
  error: { type: "Error", message: "boom" },
});

/**
 * Splits `args` the way the console's format-string pass does: the directives of the first
 * argument with `%%` read as a literal, and the arguments each `%c` consumes. The arguments after
 * those are printed as they are.
 */
function consume(args: readonly unknown[]): { directives: string[]; styles: unknown[]; rest: unknown[] } {
  const [format, ...others] = args;
  const directives = [...String(format).matchAll(/%(.)/gs)].map((match) => match[1] as string).filter((directive) => directive !== "%");
  const styles = others.slice(0, directives.length);
  return { directives, styles, rest: others.slice(directives.length) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("hands Chromium's console a format string whose %c directives consume exactly the styles", () => {
  const info = vi.spyOn(console, "info");
  const args = browserFormatter.format(RECORD, RESOURCE);
  console.info(...args);

  expect(info).toHaveBeenCalledTimes(1);
  const received = info.mock.calls[0] as unknown[];
  expect(received).toEqual([...args]);
  expect(received[0]).toContain("100%%c done");

  const { directives, styles, rest } = consume(received);
  expect(directives).toEqual(["c", "c", "c"]);
  expect(styles.every((style) => typeof style === "string" && style.includes(":"))).toBe(true);
  expect(rest).toEqual([RECORD.message, RECORD.attributes, RECORD.error]);
  expect(rest[1]).toBe(RECORD.attributes);
  expect(rest[2]).toBe(RECORD.error);
});
