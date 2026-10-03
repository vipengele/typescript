import { describe, expect, test } from "vitest";
import { parseSpec } from "./spec";

describe("parseSpec", () => {
  test("parses categories, the root and every threshold", () => {
    const { levels, issues } = parseSpec("*:warn,react:debug,a.b:off");
    expect({ ...levels }).toEqual({ "*": "warn", react: "debug", "a.b": "off" });
    expect(issues).toEqual([]);
  });

  test("returns a prototype-less object", () => {
    expect(Object.getPrototypeOf(parseSpec("a:info").levels)).toBeNull();
  });

  test.for(["", "   ", ",", " , ,", "a:info,"])("ignores empty entries without an issue in %j", (spec) => {
    expect(parseSpec(spec).issues).toEqual([]);
  });

  test("tolerates whitespace around entries and parts", () => {
    const { levels, issues } = parseSpec("  a : info ,\t*\n:\nwarn  ");
    expect({ ...levels }).toEqual({ a: "info", "*": "warn" });
    expect(issues).toEqual([]);
  });

  test("keeps the last duplicate and reports it", () => {
    const { levels, issues } = parseSpec("a:info,a:error");
    expect({ ...levels }).toEqual({ a: "error" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("a:error");
  });

  test.for([
    ["missing colon", "react"],
    ["extra colon", "a:info:warn"],
    ["empty category", ":info"],
    ["invalid category", "a..b:info"],
    ["category with a star", "a.*:info"],
    ["empty level", "a:"],
    ["unknown level", "a:loud"],
    ["inherited level name", "a:constructor"],
    ["proto level", "a:__proto__"],
  ])("skips and names a bad entry: %s", ([, entry]) => {
    const { levels, issues } = parseSpec(`ok:info,${entry},*:warn`);
    expect({ ...levels }).toEqual({ ok: "info", "*": "warn" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(JSON.stringify(entry));
  });

  test("stores a __proto__ category as an own key", () => {
    const { levels, issues } = parseSpec("__proto__:debug");
    const key = "__proto__";
    expect(Object.hasOwn(levels, key)).toBe(true);
    expect(levels[key]).toBe("debug");
    expect(Object.getPrototypeOf(levels)).toBeNull();
    expect(({} as Record<string, unknown>).debug).toBeUndefined();
    expect(issues).toEqual([]);
  });

  test.for([undefined, null, 5, {}, ["a:info"]])("never throws for the non-string %o", (value) => {
    const { levels, issues } = parseSpec(value as unknown as string);
    expect(Object.keys(levels)).toEqual([]);
    expect(issues).toHaveLength(1);
  });

  test("describes null distinctly from other non-strings", () => {
    expect(parseSpec(null as unknown as string).issues[0]).toContain("null");
    expect(parseSpec(5 as unknown as string).issues[0]).toContain("number");
  });
});
