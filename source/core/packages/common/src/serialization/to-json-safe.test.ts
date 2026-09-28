import { describe, expect, test } from "vitest";
import { toJsonSafe } from "./to-json-safe";

// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
const CUT = "…[truncated]";

function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

/** A value nested `levels` containers deep below the root, holding `leaf` at the bottom. */
function nested(levels: number, leaf: unknown): unknown {
  let value = leaf;
  for (let level = 0; level < levels; level++) {
    value = { child: value };
  }
  return value;
}

const anonymousErrorClass = (() => class extends Error {})();

test.for<[string, unknown, unknown]>([
  ["a string", "text", "text"],
  ["a finite number", -0.5, -0.5],
  ["NaN", Number.NaN, "NaN"],
  ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
  ["-Infinity", Number.NEGATIVE_INFINITY, "-Infinity"],
  ["true", true, true],
  ["false", false, false],
  ["null", null, null],
  ["undefined", undefined, null],
  ["a bigint", -42n, "-42n"],
  ["a symbol", Symbol("label"), "Symbol(label)"],
  ["a symbol without a description", Symbol(), "Symbol()"],
  ["a named function", function named(): void {}, "[Function: named]"],
  ["an anonymous function", () => undefined, "[Function: anonymous]"],
  ["a Date", new Date(Date.UTC(2026, 8, 26, 12, 30)), "2026-09-26T12:30:00.000Z"],
  ["an invalid Date", new Date(Number.NaN), "Invalid Date"],
  ["a Set", new Set([1, "two", 3n]), [1, "two", "3n"]],
  ["an array", [1, undefined, new Date(0)], [1, null, "1970-01-01T00:00:00.000Z"]],
  ["a plain object", { kept: 1, dropped: undefined }, { kept: 1 }],
  ["a revoked Proxy", revokedProxy(), "[Unreadable]"],
])("makes %s JSON-safe at the root and nested", ([, value, expected]) => {
  expect(toJsonSafe(value)).toEqual(expected);
  expect(toJsonSafe({ value })).toEqual(value === undefined ? {} : { value: expected });
  expect(toJsonSafe([value])).toEqual([expected]);
});

describe("a function", () => {
  test("names a function whose name getter throws anonymous", () => {
    const opaque = Object.defineProperty(() => undefined, "name", {
      get(): never {
        throw new Error("no name");
      },
    });

    expect(toJsonSafe(opaque)).toBe("[Function: anonymous]");
    expect(toJsonSafe({ opaque })).toEqual({ opaque: "[Function: anonymous]" });
  });
});

describe("a Map", () => {
  test("becomes a plain object with stringified keys and walked values", () => {
    const map = new Map<unknown, unknown>([
      ["name", "ada"],
      [1, new Date(0)],
      ["gone", undefined],
    ]);
    const expected = { name: "ada", 1: "1970-01-01T00:00:00.000Z" };

    expect(toJsonSafe(map)).toEqual(expected);
    expect(toJsonSafe({ map })).toEqual({ map: expected });
  });

  test("disambiguates keys that stringify to the same value, including an already-generated one", () => {
    const a = { toString: () => "dup" };
    const b = { toString: () => "dup" };
    const map = new Map<unknown, unknown>([
      [a, "first"],
      ["dup#1", "literal"],
      [b, "second"],
      ["dup", "third"],
    ]);
    const expected = { dup: "first", "dup#1": "literal", "dup#2": "second", "dup#3": "third" };

    expect(toJsonSafe(map)).toEqual(expected);
    expect(toJsonSafe([map])).toEqual([expected]);
  });

  test("applies maxBreadth and keeps the marker key clear of a retained key", () => {
    const map = new Map<string, unknown>([
      ["…", "kept"],
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);

    expect(toJsonSafe(map, { maxBreadth: 2 })).toEqual({ "…": "kept", a: 1, "…#1": "[Truncated: 2 more]" });
    expect(toJsonSafe(new Map([["a", 1]]), { maxBreadth: 0 })).toEqual({ "…": "[Truncated: 1 more]" });
  });

  test("becomes unreadable when a key cannot be stringified", () => {
    const key = {
      toString(): never {
        throw new Error("no string");
      },
    };

    expect(toJsonSafe(new Map([[key, 1]]))).toBe("[Unreadable]");
  });
});

describe("an Error", () => {
  test("keeps its type, message and stack only, at the root and nested", () => {
    const error = new TypeError("bad input", { cause: new Error("root") });
    const expected = { type: "TypeError", message: "bad input", stack: error.stack };

    expect(toJsonSafe(error)).toEqual(expected);
    expect(toJsonSafe({ error })).toEqual({ error: expected });
  });

  test("does not follow an AggregateError's errors", () => {
    const result = toJsonSafe(new AggregateError([new Error("one")], "many"));

    expect(result).toMatchObject({ type: "AggregateError", message: "many" });
    expect(result).not.toHaveProperty("errors");
  });

  test("omits a missing stack and types an unnamed or opaque constructor as Error", () => {
    const anonymous = new anonymousErrorClass("anonymous");
    const orphan = new Error("orphan");
    Object.defineProperty(orphan, "constructor", { value: null });
    Object.defineProperty(orphan, "stack", { value: undefined });
    const opaque = new Error("opaque");
    Object.defineProperty(opaque, "constructor", {
      get(): never {
        throw new Error("no constructor");
      },
    });

    expect(toJsonSafe(anonymous)).toMatchObject({ type: "Error", message: "anonymous" });
    expect(toJsonSafe(orphan)).toEqual({ type: "Error", message: "orphan" });
    expect(toJsonSafe(opaque)).toMatchObject({ type: "Error", message: "opaque" });
  });

  test("marks a message that is not a string unreadable", () => {
    const error = new Error("replaced");
    Object.defineProperty(error, "message", { value: 42 });

    expect(toJsonSafe(error)).toMatchObject({ type: "Error", message: "[Unreadable]" });
  });

  test("applies maxStringLength to its message and stack", () => {
    const error = new Error("long message");
    Object.defineProperty(error, "stack", { value: "long stack" });

    expect(toJsonSafe(error, { maxStringLength: 4 })).toEqual({ type: "Error", message: `long${CUT}`, stack: `long${CUT}` });
  });
});

describe("toJSON", () => {
  test("replaces a value with its walked toJSON result, at the root and nested", () => {
    const value = { secret: "hidden", toJSON: () => ({ shown: 1n }) };

    expect(toJsonSafe(value)).toEqual({ shown: "1n" });
    expect(toJsonSafe({ value })).toEqual({ value: { shown: "1n" } });
  });

  test("turns an undefined toJSON result into null", () => {
    expect(toJsonSafe({ toJSON: () => undefined })).toBeNull();
  });

  test("is called only once, not again on the object it returns", () => {
    const inner = { kept: true, toJSON: () => "inner toJSON called" };

    expect(toJsonSafe({ toJSON: () => inner })).toEqual({ kept: true, toJSON: "[Function: toJSON]" });
  });

  test("is ignored when it throws", () => {
    const value = {
      kept: "yes",
      toJSON(): never {
        throw new Error("no JSON");
      },
    };

    expect(toJsonSafe(value)).toEqual({ kept: "yes", toJSON: "[Function: toJSON]" });
  });

  test("is ignored when it returns the value itself", () => {
    const value = {
      kept: "yes",
      toJSON() {
        return this;
      },
    };

    expect(toJsonSafe(value)).toEqual({ kept: "yes", toJSON: "[Function: toJSON]" });
  });

  test("is ignored when reading it throws", () => {
    const value = {
      kept: "yes",
      get toJSON(): never {
        throw new Error("no toJSON");
      },
    };

    expect(toJsonSafe(value)).toEqual({ kept: "yes", toJSON: "[Unreadable]" });
  });

  test("is not called on a Date", () => {
    const at = new Date(0);
    Object.defineProperty(at, "toJSON", { value: () => "custom" });

    expect(toJsonSafe(at)).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("objects", () => {
  test("copies own enumerable string-keyed properties only", () => {
    const value = Object.create({ inherited: 1 }) as Record<PropertyKey, unknown>;
    value.own = 2;
    value[Symbol("hidden")] = 3;
    Object.defineProperty(value, "hidden", { value: 4, enumerable: false });

    expect(toJsonSafe(value)).toEqual({ own: 2 });
  });

  test("keeps a __proto__ key as a key", () => {
    const value = JSON.parse('{"__proto__": {"polluted": true}}') as unknown;
    const result = toJsonSafe(value) as Record<string, unknown>;

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toEqual({ polluted: true });
  });

  test("marks a property whose getter throws unreadable and keeps its siblings", () => {
    const value = {
      before: 1,
      get broken(): never {
        throw new Error("getter");
      },
      after: 2,
    };

    expect(toJsonSafe(value)).toEqual({ before: 1, broken: "[Unreadable]", after: 2 });
    expect(toJsonSafe([value])).toEqual([{ before: 1, broken: "[Unreadable]", after: 2 }]);
  });

  test("marks an array element whose access throws unreadable and keeps its siblings", () => {
    const list = [1, 2, 3];
    Object.defineProperty(list, 1, {
      get(): never {
        throw new Error("element");
      },
    });

    expect(toJsonSafe(list)).toEqual([1, "[Unreadable]", 3]);
  });

  test("turns a hole in a sparse array into null", () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is what the test exercises
    expect(toJsonSafe([1, , 2])).toEqual([1, null, 2]);
  });

  test("walks a Map root by its entries, not its own properties", () => {
    const map = new Map([["a", 1]]);
    Object.assign(map, { extra: true });

    expect(toJsonSafe(map)).toEqual({ a: 1 });
  });
});

describe("cycles", () => {
  test("marks a reference back to the root circular", () => {
    const root: Record<string, unknown> = { name: "root" };
    root.self = root;

    expect(toJsonSafe(root)).toEqual({ name: "root", self: "[Circular]" });
  });

  test("marks a cycle through nested containers circular", () => {
    const value: Record<string, unknown> = { name: "outer" };
    value.children = [new Map([["back", value]]), new Set([value])];

    expect(toJsonSafe({ value })).toEqual({ value: { name: "outer", children: [{ back: "[Circular]" }, ["[Circular]"]] } });
  });

  test("walks the same object in full each time it appears as a sibling", () => {
    const shared = { id: 7, tags: ["a"] };

    expect(toJsonSafe([shared, { shared }, shared])).toEqual([
      { id: 7, tags: ["a"] },
      { shared: { id: 7, tags: ["a"] } },
      { id: 7, tags: ["a"] },
    ]);
  });

  test("walks a root that toJSON returns again as a sibling in full", () => {
    const shared = { id: 1 };

    expect(toJsonSafe({ toJSON: () => [shared, shared] })).toEqual([{ id: 1 }, { id: 1 }]);
  });
});

describe("depth", () => {
  test("keeps six levels by default, the root counting as the first", () => {
    expect(toJsonSafe(nested(5, { leaf: 1 }))).toEqual(nested(5, { leaf: 1 }));
  });

  test("replaces a container deeper than six levels with Truncated by default", () => {
    expect(toJsonSafe(nested(6, { leaf: 1 }))).toEqual(nested(6, "[Truncated]"));
  });

  test("replaces a container deeper than maxDepth with Truncated and keeps leaves", () => {
    expect(toJsonSafe({ kept: "leaf", at: new Date(0), list: [1], map: new Map(), set: new Set() }, { maxDepth: 1 })).toEqual({
      kept: "leaf",
      at: "1970-01-01T00:00:00.000Z",
      list: "[Truncated]",
      map: "[Truncated]",
      set: "[Truncated]",
    });
  });

  test("truncates the root itself when maxDepth is 0", () => {
    expect(toJsonSafe({ a: 1 }, { maxDepth: 0 })).toBe("[Truncated]");
    expect(toJsonSafe("leaf", { maxDepth: 0 })).toBe("leaf");
  });
});

describe("breadth", () => {
  test("keeps 100 object entries and array items by default and summarises the rest", () => {
    const record = Object.fromEntries(Array.from({ length: 103 }, (_, index) => [`k${index}`, index]));
    const list = Array.from({ length: 105 }, (_, index) => index);
    const result = toJsonSafe({ record, list }) as { record: Record<string, unknown>; list: unknown[] };

    expect(Object.keys(result.record)).toHaveLength(101);
    expect(result.record.k99).toBe(99);
    expect(result.record).not.toHaveProperty("k100");
    expect(result.record["…"]).toBe("[Truncated: 3 more]");
    expect(result.list).toHaveLength(101);
    expect(result.list[100]).toBe("[Truncated: 5 more]");
  });

  test("keeps maxBreadth entries and items, and a container of exactly maxBreadth whole", () => {
    expect(toJsonSafe({ a: 1, b: 2, c: 3 }, { maxBreadth: 2 })).toEqual({ a: 1, b: 2, "…": "[Truncated: 1 more]" });
    expect(toJsonSafe([1, 2, 3], { maxBreadth: 2 })).toEqual([1, 2, "[Truncated: 1 more]"]);
    expect(toJsonSafe(new Set(["a", "b", "c", "d"]), { maxBreadth: 2 })).toEqual(["a", "b", "[Truncated: 2 more]"]);
    expect(toJsonSafe({ a: 1, b: 2 }, { maxBreadth: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("keeps the breadth marker key clear of retained keys that already look like it", () => {
    expect(toJsonSafe({ "…": "kept", "…#1": "also kept", a: 1 }, { maxBreadth: 2 })).toEqual({
      "…": "kept",
      "…#1": "also kept",
      "…#2": "[Truncated: 1 more]",
    });
  });
});

describe("strings", () => {
  test("keeps a string of 8192 characters whole and cuts a longer one by default", () => {
    const text = "x".repeat(8192);

    expect(toJsonSafe(text)).toBe(text);
    expect(toJsonSafe(`${text}yz`)).toBe(`${text}${CUT}`);
  });

  test("applies maxStringLength to strings and coerced strings", () => {
    expect(
      toJsonSafe(
        { text: "abcdef", kept: "abcd", big: 123456n, nan: Number.NaN, symbol: Symbol("long"), fn: function longName(): void {} },
        { maxStringLength: 4 },
      ),
    ).toEqual({
      text: `abcd${CUT}`,
      kept: "abcd",
      big: `1234${CUT}`,
      nan: "NaN",
      symbol: `Symb${CUT}`,
      fn: `[Fun${CUT}`,
    });
  });
});
