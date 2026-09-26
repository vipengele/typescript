import { expect, test } from "vitest";
import type { AttributesInput } from "./attribute-value";
import { normalizeAttributes } from "./normalize-attributes";

// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
const CUT = "…[truncated]";

function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

/** An object nested `levels` containers deep below the input record, holding `leaf` at the bottom. */
function nested(levels: number, leaf: unknown): unknown {
  let value = leaf;
  for (let level = 0; level < levels; level++) {
    value = { child: value };
  }
  return value;
}

test.for(["text", 42, -0.5, true, false, null])("passes the primitive %o through unchanged", (value) => {
  expect(normalizeAttributes({ value })).toEqual({ value });
});

test("drops an undefined object property", () => {
  const result = normalizeAttributes({ kept: 1, dropped: undefined });

  expect(result).toEqual({ kept: 1 });
  expect(Object.hasOwn(result, "dropped")).toBe(false);
});

test("turns an undefined array element into null", () => {
  expect(normalizeAttributes({ list: [1, undefined, 2] })).toEqual({ list: [1, null, 2] });
});

test("turns a hole in a sparse array into null", () => {
  // biome-ignore lint/suspicious/noSparseArray: the hole is what the test exercises
  expect(normalizeAttributes({ list: [1, , 2] })).toEqual({ list: [1, null, 2] });
});

test.for<[unknown, string]>([
  [10n, "10n"],
  [-42n, "-42n"],
  [function named(): void {}, "[Function: named]"],
  [() => undefined, "[Function: anonymous]"],
  [Symbol("label"), "Symbol(label)"],
  [Symbol(), "Symbol()"],
])("coerces %o to %o", ([value, expected]) => {
  expect(normalizeAttributes({ value })).toEqual({ value: expected });
});

test("names a function whose name getter throws anonymous", () => {
  const opaque = Object.defineProperty(() => undefined, "name", {
    get(): never {
      throw new Error("no name");
    },
  });

  expect(normalizeAttributes({ value: opaque })).toEqual({ value: "[Function: anonymous]" });
});

test("turns a Date into its ISO string", () => {
  expect(normalizeAttributes({ at: new Date(Date.UTC(2026, 8, 26, 12, 30)) })).toEqual({ at: "2026-09-26T12:30:00.000Z" });
});

test("turns an invalid Date into the string Invalid Date", () => {
  expect(normalizeAttributes({ at: new Date(Number.NaN) })).toEqual({ at: "Invalid Date" });
});

test("turns a Map into a plain object with normalized values", () => {
  const map = new Map<unknown, unknown>([
    ["name", "ada"],
    [1, new Date(0)],
    ["gone", undefined],
  ]);

  expect(normalizeAttributes({ map })).toEqual({ map: { name: "ada", 1: "1970-01-01T00:00:00.000Z" } });
});

test("turns a Set into an array with normalized items", () => {
  expect(normalizeAttributes({ set: new Set([1, "two", 3n]) })).toEqual({ set: [1, "two", "3n"] });
});

test("replaces a value with the normalized result of its toJSON", () => {
  const value = { secret: "hidden", toJSON: () => ({ shown: 1n }) };

  expect(normalizeAttributes({ value })).toEqual({ value: { shown: "1n" } });
});

test("calls toJSON only once, not again on the object it returns", () => {
  const inner = { kept: true, toJSON: () => "inner toJSON called" };
  const value = { toJSON: () => inner };

  expect(normalizeAttributes({ value })).toEqual({ value: { kept: true, toJSON: "[Function: toJSON]" } });
});

test("walks the object itself when toJSON throws", () => {
  const value = {
    kept: "yes",
    toJSON(): never {
      throw new Error("no JSON");
    },
  };

  expect(normalizeAttributes({ value })).toEqual({ value: { kept: "yes", toJSON: "[Function: toJSON]" } });
});

test("walks the object itself when toJSON returns it", () => {
  const value = {
    kept: "yes",
    toJSON() {
      return this;
    },
  };

  expect(normalizeAttributes({ value })).toEqual({ value: { kept: "yes", toJSON: "[Function: toJSON]" } });
});

test("walks the object itself when reading toJSON throws", () => {
  const value = {
    kept: "yes",
    get toJSON(): never {
      throw new Error("no toJSON");
    },
  };

  expect(normalizeAttributes({ value })).toEqual({ value: { kept: "yes", toJSON: "[Unreadable]" } });
});

test("copies own enumerable properties only", () => {
  const value = Object.create({ inherited: 1 }) as Record<string, unknown>;
  value.own = 2;
  Object.defineProperty(value, "hidden", { value: 3, enumerable: false });

  expect(normalizeAttributes({ value })).toEqual({ value: { own: 2 } });
});

test("keeps a __proto__ key as a key", () => {
  const value = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
  const result = normalizeAttributes({ value }).value as Record<string, unknown>;

  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.hasOwn(result, "__proto__")).toBe(true);
});

test("marks a property whose getter throws unreadable and keeps its siblings", () => {
  const value = {
    before: 1,
    get broken(): never {
      throw new Error("getter");
    },
    after: 2,
  };

  expect(normalizeAttributes({ value })).toEqual({ value: { before: 1, broken: "[Unreadable]", after: 2 } });
});

test("marks a top-level property whose getter throws unreadable and keeps its siblings", () => {
  const input = {
    before: 1,
    get broken(): never {
      throw new Error("getter");
    },
  };

  expect(normalizeAttributes(input)).toEqual({ before: 1, broken: "[Unreadable]" });
});

test("normalizes an array element by element", () => {
  expect(normalizeAttributes({ list: [1, new Date(0), new Set(["a"]), { nested: 2n }] })).toEqual({
    list: [1, "1970-01-01T00:00:00.000Z", ["a"], { nested: "2n" }],
  });
});

test("marks an array element whose access throws unreadable and keeps its siblings", () => {
  const list = [1, 2, 3];
  Object.defineProperty(list, 1, {
    get(): never {
      throw new Error("element");
    },
  });

  expect(normalizeAttributes({ list })).toEqual({ list: [1, "[Unreadable]", 3] });
});

test("marks a value unreadable when inspecting it throws", () => {
  expect(normalizeAttributes({ kept: 1, proxy: revokedProxy() })).toEqual({ kept: 1, proxy: "[Unreadable]" });
});

test("normalizes an input whose keys cannot be listed to an empty record", () => {
  expect(normalizeAttributes(revokedProxy() as AttributesInput)).toEqual({});
});

test("gives a nested Error its type, message and stack only", () => {
  const cause = new Error("root");
  const error = new TypeError("bad input", { cause });
  const result = normalizeAttributes({ error }).error as Record<string, unknown>;

  expect(result).toEqual({ type: "TypeError", message: "bad input", stack: error.stack });
  expect(Object.keys(result).sort()).toEqual(["message", "stack", "type"]);
});

test("does not follow an AggregateError's errors", () => {
  const result = normalizeAttributes({ error: new AggregateError([new Error("one")], "many") }).error;

  expect(result).toMatchObject({ type: "AggregateError", message: "many" });
  expect(result).not.toHaveProperty("errors");
  expect(result).not.toHaveProperty("cause");
  expect(result).not.toHaveProperty("synthetic");
});

test("omits the stack of an Error that has none", () => {
  const error = new Error("no stack");
  Object.defineProperty(error, "stack", { value: undefined });

  expect(normalizeAttributes({ error })).toEqual({ error: { type: "Error", message: "no stack" } });
});

test("types an Error without a named constructor as Error", () => {
  const anonymous = new ((() => class extends Error {})())("anonymous");
  const orphan = new Error("orphan");
  Object.defineProperty(orphan, "constructor", { value: null });
  const opaque = new Error("opaque");
  Object.defineProperty(opaque, "constructor", {
    value: Object.defineProperty(() => undefined, "name", {
      get(): never {
        throw new Error("no name");
      },
    }),
  });

  expect(normalizeAttributes({ anonymous, orphan, opaque })).toMatchObject({
    anonymous: { type: "Error", message: "anonymous" },
    orphan: { type: "Error", message: "orphan" },
    opaque: { type: "Error", message: "opaque" },
  });
});

test("marks an Error message that is not a string unreadable", () => {
  const error = new Error("replaced");
  Object.defineProperty(error, "message", { value: 42 });

  expect(normalizeAttributes({ error })).toMatchObject({ error: { type: "Error", message: "[Unreadable]" } });
});

test("marks an Error message whose getter throws unreadable", () => {
  const error = new Error("replaced");
  Object.defineProperty(error, "message", {
    get(): never {
      throw new Error("message");
    },
  });

  expect(normalizeAttributes({ error })).toMatchObject({ error: { type: "Error", message: "[Unreadable]" } });
});

test("marks a self-reference circular and keeps the rest", () => {
  const value: Record<string, unknown> = { name: "loop" };
  value.self = value;

  expect(normalizeAttributes({ value, other: 1 })).toEqual({ value: { name: "loop", self: "[Circular]" }, other: 1 });
});

test("marks a cycle through nested containers circular", () => {
  const value: Record<string, unknown> = { name: "outer" };
  value.children = [new Map([["back", value]])];

  expect(normalizeAttributes({ value })).toEqual({ value: { name: "outer", children: [{ back: "[Circular]" }] } });
});

test("marks a reference back to the input record circular", () => {
  const input: Record<string, unknown> = { name: "root" };
  input.self = input;

  expect(normalizeAttributes(input)).toEqual({ name: "root", self: "[Circular]" });
});

test("normalizes the same object in full each time it appears as a sibling", () => {
  const shared = { id: 7, tags: ["a"] };

  expect(normalizeAttributes({ first: shared, second: shared, list: [shared, shared] })).toEqual({
    first: { id: 7, tags: ["a"] },
    second: { id: 7, tags: ["a"] },
    list: [
      { id: 7, tags: ["a"] },
      { id: 7, tags: ["a"] },
    ],
  });
});

test("keeps six levels of nesting by default", () => {
  expect(normalizeAttributes({ root: nested(4, { leaf: 1 }) })).toEqual({ root: nested(4, { leaf: 1 }) });
});

test("replaces a container deeper than six levels with Truncated by default", () => {
  expect(normalizeAttributes({ root: nested(5, { leaf: 1 }) })).toEqual({ root: nested(5, "[Truncated]") });
});

test("replaces a container deeper than maxDepth with Truncated", () => {
  expect(normalizeAttributes({ kept: "leaf", list: [1], map: new Map() }, { maxDepth: 1 })).toEqual({
    kept: "leaf",
    list: "[Truncated]",
    map: "[Truncated]",
  });
});

test("keeps a leaf value below maxDepth", () => {
  expect(normalizeAttributes({ at: nested(1, new Date(0)) }, { maxDepth: 2 })).toEqual({ at: nested(1, "1970-01-01T00:00:00.000Z") });
});

test("keeps 100 object entries by default and summarises the rest", () => {
  const value = Object.fromEntries(Array.from({ length: 103 }, (_, index) => [`k${index}`, index]));
  const result = normalizeAttributes({ value }).value as Record<string, unknown>;

  expect(Object.keys(result)).toHaveLength(101);
  expect(result.k99).toBe(99);
  expect(result).not.toHaveProperty("k100");
  expect(result["…"]).toBe("[Truncated: 3 more]");
});

test("keeps maxBreadth object entries and summarises the rest", () => {
  expect(normalizeAttributes({ value: { a: 1, b: 2, c: 3, d: 4 } }, { maxBreadth: 2 })).toEqual({
    value: { a: 1, b: 2, "…": "[Truncated: 2 more]" },
  });
});

test("applies maxBreadth to the input record", () => {
  expect(normalizeAttributes({ a: 1, b: 2, c: 3 }, { maxBreadth: 1 })).toEqual({ a: 1, "…": "[Truncated: 2 more]" });
});

test("keeps an object of exactly maxBreadth entries whole", () => {
  expect(normalizeAttributes({ value: { a: 1, b: 2 } }, { maxBreadth: 2 })).toEqual({ value: { a: 1, b: 2 } });
});

test("keeps 100 array items by default and summarises the rest", () => {
  const list = Array.from({ length: 105 }, (_, index) => index);
  const result = normalizeAttributes({ list }).list as unknown[];

  expect(result).toHaveLength(101);
  expect(result[99]).toBe(99);
  expect(result[100]).toBe("[Truncated: 5 more]");
});

test("keeps maxBreadth array items and summarises the rest", () => {
  expect(normalizeAttributes({ list: [1, 2, 3], set: new Set(["a", "b", "c", "d"]) }, { maxBreadth: 2 })).toEqual({
    list: [1, 2, "[Truncated: 1 more]"],
    set: ["a", "b", "[Truncated: 2 more]"],
  });
});

test("keeps a string of 8192 characters whole by default", () => {
  const text = "x".repeat(8192);

  expect(normalizeAttributes({ text })).toEqual({ text });
});

test("cuts a string longer than 8192 characters by default", () => {
  expect(normalizeAttributes({ text: `${"x".repeat(8192)}yz` })).toEqual({ text: `${"x".repeat(8192)}${CUT}` });
});

test("cuts a string longer than maxStringLength", () => {
  expect(normalizeAttributes({ text: "abcdef", list: ["abcd"] }, { maxStringLength: 4 })).toEqual({
    text: `abcd${CUT}`,
    list: ["abcd"],
  });
});

test("applies maxStringLength to coerced strings and Error fields", () => {
  const error = new Error("long message");
  Object.defineProperty(error, "stack", { value: "long stack" });

  expect(normalizeAttributes({ big: 123456n, error }, { maxStringLength: 4 })).toEqual({
    big: `1234${CUT}`,
    error: { type: "Error", message: `long${CUT}`, stack: `long${CUT}` },
  });
});
