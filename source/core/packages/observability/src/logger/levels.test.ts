import { type Level, SEVERITY_NUMBERS } from "@vipengele/ts-core-common";
import { describe, expect, test } from "vitest";
import { isLoggingConfigError } from "./config-error";
import {
  enabled,
  entryFor,
  isThreshold,
  type LevelEntry,
  type LevelTable,
  OFF_SEVERITY,
  resolveEntry,
  severityOf,
  validateThreshold,
} from "./levels";

const levels: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const notThresholds = ["", "Warn", "WARN", "warning", "none", "constructor", "__proto__", "toString", null, undefined, 13, {}];

describe("isThreshold", () => {
  test.for([...levels, "off"])("accepts %j", (value) => {
    expect(isThreshold(value)).toBe(true);
  });

  test.for(notThresholds)("rejects %o", (value) => {
    expect(isThreshold(value)).toBe(false);
  });
});

describe("validateThreshold", () => {
  test.for([...levels, "off"])("returns %j unchanged", (value) => {
    expect(validateThreshold(value)).toBe(value);
  });

  test.for(notThresholds)("throws a LoggingConfigError for %o", (value) => {
    expect(() => validateThreshold(value)).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("names a bad string in the message", () => {
    expect(() => validateThreshold("constructor")).toThrow('Invalid logger level "constructor"');
  });

  test("names the type of a non-string in the message", () => {
    expect(() => validateThreshold(null)).toThrow("Invalid logger level of type null");
    expect(() => validateThreshold(13)).toThrow("Invalid logger level of type number");
  });
});

describe("severityOf", () => {
  test.for(levels)("is the OpenTelemetry severity number of %s", (level) => {
    expect(severityOf(level)).toBe(SEVERITY_NUMBERS[level]);
  });

  test("off sits above every level and every OpenTelemetry severity number", () => {
    expect(severityOf("off")).toBe(OFF_SEVERITY);
    expect(OFF_SEVERITY).toBeGreaterThan(24);
    for (const level of levels) {
      expect(severityOf("off")).toBeGreaterThan(severityOf(level));
    }
  });
});

describe("entryFor", () => {
  test("carries the threshold and its severity", () => {
    expect(entryFor("debug")).toEqual({ level: "debug", severity: 5 });
    expect(entryFor("off")).toEqual({ level: "off", severity: OFF_SEVERITY });
  });

  test("is a plain object", () => {
    expect(Object.getPrototypeOf(entryFor("warn"))).toBe(Object.prototype);
  });
});

describe("enabled", () => {
  test("a record at or above the entry's level is enabled, one below is not", () => {
    const warn = entryFor("warn");

    expect(levels.filter((level) => enabled(warn, level))).toEqual(["warn", "error", "fatal"]);
  });

  test("trace enables every level", () => {
    expect(levels.every((level) => enabled(entryFor("trace"), level))).toBe(true);
  });

  test("off enables nothing, fatal included", () => {
    expect(levels.some((level) => enabled(entryFor("off"), level))).toBe(false);
  });

  test("compares the carried severity, not the level name", () => {
    const unknownToThisCopy = { level: "notice", severity: 11 } as unknown as LevelEntry;

    expect(enabled(unknownToThisCopy, "info")).toBe(false);
    expect(enabled(unknownToThisCopy, "warn")).toBe(true);
  });
});

describe("resolveEntry", () => {
  const root = entryFor("warn");
  const react = entryFor("debug");
  const reactDom = entryFor("trace");
  const table: LevelTable = { "*": root, react, "react.dom": reactDom };

  test("an exact key wins", () => {
    expect(resolveEntry(table, "react")).toBe(react);
    expect(resolveEntry(table, "react.dom")).toBe(reactDom);
  });

  test("the longest dot-boundary prefix wins", () => {
    expect(resolveEntry(table, "react.dom.server")).toBe(reactDom);
    expect(resolveEntry(table, "react.native")).toBe(react);
  });

  test("a prefix that ends inside a segment does not govern", () => {
    expect(resolveEntry(table, "reactive")).toBe(root);
    expect(resolveEntry(table, "react.domain")).toBe(react);
  });

  test("matching is case-sensitive", () => {
    expect(resolveEntry(table, "React")).toBe(root);
  });

  test("an unmatched category falls to the root", () => {
    expect(resolveEntry(table, "services.editing")).toBe(root);
  });

  test("the root resolves to its own entry", () => {
    expect(resolveEntry(table, "*")).toBe(root);
  });

  test("a table without a root resolves an unmatched category to undefined", () => {
    const rootless: LevelTable = { react };

    expect(resolveEntry(rootless, "services")).toBeUndefined();
    expect(resolveEntry(rootless, "services")).toBeUndefined();
    expect(resolveEntry(rootless, "react.dom")).toBe(react);
  });

  test("inherited properties never resolve", () => {
    const plain: LevelTable = { "*": root };

    expect(resolveEntry(plain, "constructor")).toBe(root);
    expect(resolveEntry(plain, "__proto__")).toBe(root);
    expect(resolveEntry(plain, "toString.x")).toBe(root);
    expect(resolveEntry({}, "constructor")).toBeUndefined();
  });

  test("an own __proto__ key resolves like any other", () => {
    const own = JSON.parse('{"__proto__": {"level": "error", "severity": 17}}') as LevelTable;

    expect(resolveEntry(own, "__proto__.x")).toEqual({ level: "error", severity: 17 });
  });

  test("a prototype-less table resolves", () => {
    const bare = Object.assign(Object.create(null) as Record<string, LevelEntry>, { "*": root, react });

    expect(resolveEntry(bare, "react.dom")).toBe(react);
    expect(resolveEntry(bare, "constructor")).toBe(root);
  });

  test("a resolution is cached by table identity", () => {
    const cached: Record<string, LevelEntry> = { "*": root };

    expect(resolveEntry(cached, "services")).toBe(root);
    cached.services = react;
    expect(resolveEntry(cached, "services")).toBe(root);
  });

  test("a replaced table resolves afresh", () => {
    const first: LevelTable = { "*": root };
    expect(resolveEntry(first, "services")).toBe(root);

    const second: LevelTable = { ...first, services: react };
    expect(resolveEntry(second, "services")).toBe(react);
    expect(resolveEntry(first, "services")).toBe(root);
  });

  test("a cached miss stays a miss for that table", () => {
    const rootless: Record<string, LevelEntry> = {};

    expect(resolveEntry(rootless, "a")).toBeUndefined();
    rootless["*"] = root;
    expect(resolveEntry(rootless, "a")).toBeUndefined();
  });
});
