import { afterEach, describe, expect, test, vi } from "vitest";
import { entryFor, type LevelTable, OFF_SEVERITY, resolveEntry } from "./levels";
import { getOrCreateDefaultProvider, normalizeEntry, normalizeTable, publishLevelTable, readLevelTable, resolveSharedEntry } from "./slots";

const LEVELS_SLOT = Symbol.for("vipengele.logger.levels");
const PROVIDER_SLOT = Symbol.for("vipengele.logger.provider.v1");

type Registry = Record<symbol, unknown>;
const registry = globalThis as unknown as Registry;

afterEach(() => {
  delete registry[LEVELS_SLOT];
  delete registry[PROVIDER_SLOT];
});

describe("module load", () => {
  test("importing the module touches neither slot", async () => {
    vi.resetModules();
    await import("./slots");
    expect(Object.hasOwn(globalThis, LEVELS_SLOT)).toBe(false);
    expect(Object.hasOwn(globalThis, PROVIDER_SLOT)).toBe(false);
  });
});

describe("readLevelTable", () => {
  test("publishes the default warn root on first read of an empty slot", () => {
    const table = readLevelTable();
    expect({ ...table }).toEqual({ "*": entryFor("warn") });
    expect(registry[LEVELS_SLOT]).toBe(table);
    expect(Object.isFrozen(table)).toBe(true);
  });

  test("returns the same table on every read", () => {
    expect(readLevelTable()).toBe(readLevelTable());
  });

  test("reads a table another copy wrote first and leaves it in place", () => {
    const theirs = { "*": entryFor("error"), app: entryFor("debug") };
    registry[LEVELS_SLOT] = theirs;
    expect(readLevelTable()).toBe(theirs);
    expect(registry[LEVELS_SLOT]).toBe(theirs);
    expect(theirs).toEqual({ "*": entryFor("error"), app: entryFor("debug") });
  });

  test("never mutates a foreign table it has to normalise", () => {
    const theirs = { "*": { level: "verbose", severity: 3 } };
    registry[LEVELS_SLOT] = theirs;
    const view = readLevelTable();
    expect({ ...view }).toEqual({ "*": entryFor("debug") });
    expect(registry[LEVELS_SLOT]).toBe(theirs);
    expect(theirs).toEqual({ "*": { level: "verbose", severity: 3 } });
  });

  test("keeps one view per foreign table, and a new one once the table is replaced", () => {
    registry[LEVELS_SLOT] = { "*": { level: "verbose", severity: 3 } };
    const first = readLevelTable();
    expect(readLevelTable()).toBe(first);
    registry[LEVELS_SLOT] = { "*": { level: "verbose", severity: 3 } };
    expect(readLevelTable()).not.toBe(first);
  });

  test("reads a slot holding a non-object as the default table, without overwriting it", () => {
    registry[LEVELS_SLOT] = 42;
    const table = readLevelTable();
    expect({ ...table }).toEqual({ "*": entryFor("warn") });
    expect(readLevelTable()).toBe(table);
    expect(registry[LEVELS_SLOT]).toBe(42);
  });
});

describe("publishLevelTable", () => {
  test("replaces the slot's table and leaves the replaced one untouched", () => {
    const before = readLevelTable();
    const published = publishLevelTable({ "*": entryFor("info") });
    expect(registry[LEVELS_SLOT]).toBe(published);
    expect(published).not.toBe(before);
    expect({ ...before }).toEqual({ "*": entryFor("warn") });
    expect(readLevelTable()).toBe(published);
  });

  test("publishes a frozen copy, so the caller's table can change without reaching the slot", () => {
    const mine: Record<string, ReturnType<typeof entryFor>> = { "*": entryFor("info") };
    const published = publishLevelTable(mine);
    expect(published).not.toBe(mine);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published["*"])).toBe(true);
    mine["*"] = entryFor("trace");
    expect(readLevelTable()["*"]).toEqual(entryFor("info"));
  });

  test("keeps a __proto__ category as an own key", () => {
    const mine: Record<string, ReturnType<typeof entryFor>> = Object.create(null);
    mine["*"] = entryFor("warn");
    Object.defineProperty(mine, "__proto__", { value: entryFor("trace"), enumerable: true });
    const published = publishLevelTable(mine);
    expect(Object.getPrototypeOf(published)).toBeNull();
    expect(resolveEntry(published, "__proto__")).toEqual(entryFor("trace"));
    expect(resolveSharedEntry("constructor")).toEqual(entryFor("warn"));
  });

  test("first publish wins over a later read's default", () => {
    const published = publishLevelTable({ "*": entryFor("error") });
    expect(readLevelTable()).toBe(published);
  });
});

describe("normalizeEntry", () => {
  test.for(["trace", "debug", "info", "warn", "error", "fatal", "off"] as const)("keeps the known threshold %s", (level) => {
    expect(normalizeEntry(entryFor(level))).toEqual(entryFor(level));
  });

  test("trusts a known level name over a severity that disagrees", () => {
    expect(normalizeEntry({ level: "info", severity: 1 })).toEqual(entryFor("info"));
  });

  test.for([
    [1, "trace"],
    [3, "debug"],
    [5, "debug"],
    [11, "warn"],
    [13, "warn"],
    [20, "fatal"],
    [21, "fatal"],
    [22, "off"],
    [24, "off"],
    [OFF_SEVERITY, "off"],
    [1000, "off"],
    [0, "trace"],
    [-5, "trace"],
  ] as const)("places an unknown level carrying severity %d at %s", ([severity, expected]) => {
    expect(normalizeEntry({ level: "custom", severity })).toEqual(entryFor(expected));
  });

  test.for([
    null,
    undefined,
    "warn",
    13,
    {},
    { level: "custom" },
    { level: "custom", severity: "13" },
    { level: "custom", severity: Number.NaN },
    { level: "custom", severity: Number.POSITIVE_INFINITY },
    { level: "custom", severity: Number.NEGATIVE_INFINITY },
    { level: "constructor", severity: Number.NaN },
  ])("falls back to warn for the malformed entry %o", (value) => {
    expect(normalizeEntry(value)).toEqual(entryFor("warn"));
  });
});

describe("normalizeTable", () => {
  test("returns a table it fully understands as-is", () => {
    const table = { "*": entryFor("warn"), app: entryFor("off") };
    expect(normalizeTable(table)).toBe(table);
  });

  test("builds a prototype-less view mapping every entry", () => {
    const source = {
      "*": { level: "notice", severity: 11 },
      app: entryFor("debug"),
      broken: "nope",
      __proto__x: { level: "info", severity: 2 },
    };
    const view = normalizeTable(source);
    expect(Object.getPrototypeOf(view)).toBeNull();
    expect({ ...view }).toEqual({
      "*": entryFor("warn"),
      app: entryFor("debug"),
      broken: entryFor("warn"),
      __proto__x: entryFor("info"),
    });
  });

  test.for([null, "warn", 13])("maps a root entry of %o to warn", (entry) => {
    expect({ ...normalizeTable({ "*": entry }) }).toEqual({ "*": entryFor("warn") });
  });

  test("returns the same view for the same source table", () => {
    const source = { "*": { level: "notice", severity: 11 } };
    expect(normalizeTable(source)).toBe(normalizeTable(source));
  });

  test("returns one default table for every non-object", () => {
    const fromNull = normalizeTable(null);
    expect({ ...fromNull }).toEqual({ "*": entryFor("warn") });
    expect(normalizeTable("x")).toBe(fromNull);
  });
});

describe("resolveSharedEntry", () => {
  test("resolves through the shared table by longest prefix", () => {
    publishLevelTable({ "*": entryFor("error"), app: entryFor("debug") });
    expect(resolveSharedEntry("app.view")).toEqual(entryFor("debug"));
    expect(resolveSharedEntry("other")).toEqual(entryFor("error"));
  });

  test("resolves an unknown level another copy wrote by its severity, never to everything on", () => {
    registry[LEVELS_SLOT] = { "*": { level: "verbose", severity: 3 }, app: { level: "critical", severity: 23 } };
    expect(resolveSharedEntry("lib")).toEqual(entryFor("debug"));
    expect(resolveSharedEntry("app")).toEqual(entryFor("off"));
  });

  test("sees a replacement made after an earlier resolution", () => {
    expect(resolveSharedEntry("app")).toEqual(entryFor("warn"));
    publishLevelTable({ "*": entryFor("trace") });
    expect(resolveSharedEntry("app")).toEqual(entryFor("trace"));
  });

  test("falls back to warn for a table with no root", () => {
    const table: LevelTable = { app: entryFor("debug") };
    publishLevelTable(table);
    expect(resolveSharedEntry("other")).toEqual(entryFor("warn"));
    expect(resolveSharedEntry("app")).toEqual(entryFor("debug"));
  });
});

describe("getOrCreateDefaultProvider", () => {
  test("creates and stores the provider on first use", () => {
    const provider = { name: "mine" };
    const create = vi.fn(() => provider);
    expect(getOrCreateDefaultProvider(create)).toBe(provider);
    expect(registry[PROVIDER_SLOT]).toBe(provider);
    expect(create).toHaveBeenCalledOnce();
  });

  test("the first caller wins; a later caller's factory is never invoked", () => {
    const first = getOrCreateDefaultProvider(() => ({ name: "first" }));
    const later = vi.fn(() => ({ name: "later" }));
    expect(getOrCreateDefaultProvider(later)).toBe(first);
    expect(later).not.toHaveBeenCalled();
  });

  test("returns a provider another copy stored first", () => {
    const theirs = { name: "theirs" };
    registry[PROVIDER_SLOT] = theirs;
    const create = vi.fn(() => ({ name: "mine" }));
    expect(getOrCreateDefaultProvider(create)).toBe(theirs);
    expect(create).not.toHaveBeenCalled();
  });

  test("leaves the slot empty when the factory throws", () => {
    expect(() =>
      getOrCreateDefaultProvider(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(Object.hasOwn(globalThis, PROVIDER_SLOT)).toBe(false);
  });
});
