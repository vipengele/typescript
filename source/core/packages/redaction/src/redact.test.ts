import { describe, expect, test, vi } from "vitest";
import type { RedactionPolicy } from "./key-matcher";
import { STRING_TRUNCATION_SUFFIX } from "./limits";
import { redact } from "./redact";

const policy: RedactionPolicy = { keys: ["password", "token", "secret"] };

describe("matched keys", () => {
  test("a matched value is replaced whole with the default replacement, never descended into", () => {
    const result = redact({ user: "ada", secret: { password: "x", nested: [1, 2] } }, policy);
    expect(result).toEqual({ user: "ada", secret: "[REDACTED]" });
  });

  test("a function replacement is called with the matched value and its key", () => {
    const replacement = vi.fn((value: unknown, key: string) => `${key}:${typeof value}`);
    const token = { raw: "abc" };

    const result = redact({ token }, policy, { replacement });

    expect(replacement).toHaveBeenCalledExactlyOnceWith(token, "token");
    expect(result).toEqual({ token: "token:object" });
  });

  test("a string replacement is used in place of the default", () => {
    expect(redact({ password: "x" }, policy, { replacement: "***" })).toEqual({ password: "***" });
  });

  test("array elements are walked but never matched, since they have no key", () => {
    expect(redact(["password", { password: "x" }], policy)).toEqual(["password", { password: "[REDACTED]" }]);
  });

  test("an own __proto__ key is copied as a field, not used as the copy's prototype", () => {
    const input: unknown = JSON.parse('{"__proto__": {"password": "x", "id": 1}}');

    const result = redact(input, policy) as Record<string, unknown>;

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toEqual({ password: "[REDACTED]", id: 1 });
  });

  test("an own toJSON is dropped rather than copied, so serializing the redacted copy can't invoke it", () => {
    const secretPassword = "hunter2";
    // An own enumerable field, not a prototype method: `Object.keys()` only sees this because it
    // is a class field (assigned in the constructor), which is what the fix actually has to drop.
    class Account {
      readonly password = secretPassword;
      readonly toJSON = () => ({ password: secretPassword, leaked: true });
    }
    expect(Object.hasOwn(new Account(), "toJSON")).toBe(true);

    const result = redact(new Account(), policy);

    expect(result).toEqual({ password: "[REDACTED]" });
    expect(JSON.stringify(result)).not.toContain(secretPassword);
    expect(JSON.stringify(result)).not.toContain("leaked");
  });
});

describe("cycles", () => {
  test("a plain object referencing itself resolves the reference to [Circular]", () => {
    const input: Record<string, unknown> = { id: 1, password: "x" };
    input.self = input;

    expect(redact(input, policy)).toEqual({ id: 1, password: "[REDACTED]", self: "[Circular]" });
  });

  test("an array containing itself resolves the element to [Circular]", () => {
    const input: unknown[] = [{ password: "x" }];
    input.push(input);

    expect(redact(input, policy)).toEqual([{ password: "[REDACTED]" }, "[Circular]"]);
  });

  test("a class instance with a field pointing back to itself resolves the field to [Circular]", () => {
    class Session {
      readonly token = "abc";
      readonly self: Session = this;
    }

    const result = redact(new Session(), policy);

    expect(result).toEqual({ token: "[REDACTED]", self: "[Circular]" });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  test("a cycle through a Map, a Set and an Error cause is detected on each", () => {
    const map = new Map<string, unknown>();
    map.set("me", map);
    const set = new Set<unknown>();
    set.add(set);
    const error = new Error("loop");
    error.cause = error;

    expect(redact(map, policy)).toEqual(new Map([["me", "[Circular]"]]));
    expect(redact(set, policy)).toEqual(new Set(["[Circular]"]));
    expect((redact(error, policy) as Record<string, unknown>).cause).toBe("[Circular]");
  });

  test("an object shared by two sibling branches is walked independently in each", () => {
    const shared = { a: 1, password: "x" };
    const input = { x: shared, y: shared, list: [shared, shared] };

    const result = redact(input, policy) as { x: unknown; y: unknown; list: unknown[] };

    expect(result.x).toEqual({ a: 1, password: "[REDACTED]" });
    expect(result.y).toEqual({ a: 1, password: "[REDACTED]" });
    expect(result.list).toEqual([result.x, result.x]);
    expect(result.x).not.toBe(result.y);
    expect(result.x).not.toBe(shared);
    expect(result.y).not.toBe(shared);
  });
});

describe("Map", () => {
  test("a matched string key has its value replaced whole; an unmatched one has its value walked", () => {
    const input = new Map<string, unknown>([
      ["token", { raw: "abc" }],
      ["profile", { name: "ada", password: "x" }],
    ]);

    const result = redact(input, policy);

    expect(result).toBeInstanceOf(Map);
    expect(result).not.toBe(input);
    expect(result).toEqual(
      new Map<string, unknown>([
        ["token", "[REDACTED]"],
        ["profile", { name: "ada", password: "[REDACTED]" }],
      ]),
    );
  });

  test("a non-string key is kept as-is and its value is still walked", () => {
    const objectKey = { password: "key-is-not-walked" };
    const input = new Map<unknown, unknown>([
      [7, { password: "x" }],
      [objectKey, { token: "y", id: 2 }],
    ]);

    const result = redact(input, policy) as Map<unknown, unknown>;

    expect(result.get(7)).toEqual({ password: "[REDACTED]" });
    expect(result.get(objectKey)).toEqual({ token: "[REDACTED]", id: 2 });
    expect([...result.keys()][1]).toBe(objectKey);
    expect(objectKey).toEqual({ password: "key-is-not-walked" });
  });
});

describe("Set", () => {
  test("every member is walked into a new Set", () => {
    const input = new Set([{ password: "x" }, { password: "y", id: 1 }]);

    const result = redact(input, policy);

    expect(result).toBeInstanceOf(Set);
    expect(result).not.toBe(input);
    expect(result).toEqual(new Set([{ password: "[REDACTED]" }, { password: "[REDACTED]", id: 1 }]));
  });
});

describe("pass-through values", () => {
  test("Dates, buffers and their views, functions and symbols are returned by reference", () => {
    const input = {
      date: new Date(0),
      bytes: new Uint8Array([1, 2]),
      view: new DataView(new ArrayBuffer(2)),
      buffer: new ArrayBuffer(4),
      callback: () => "password",
      tag: Symbol("tag"),
    };

    const result = redact(input, policy) as typeof input;

    expect(result).not.toBe(input);
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
      expect(result[key]).toBe(input[key]);
    }
  });

  test("RegExps and boxed primitives are returned by reference, not walked into an empty object", () => {
    const input = {
      pattern: /^\d+$/,
      boxed: new String("password"),
    };

    const result = redact(input, policy) as typeof input;

    expect(result).not.toBe(input);
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
      expect(result[key]).toBe(input[key]);
    }
  });

  test("a URL is walked to an empty object rather than passed through, since it can carry credentials no key rule could name", () => {
    const url = new URL("https://example.com/path");
    url.password = "hunter2";
    url.searchParams.set("access_token", "abc");

    const result = redact({ link: url }, policy) as { link: unknown };

    expect(result.link).not.toBe(url);
    expect(result.link).toEqual({});
  });

  test("a Promise is walked to an empty object rather than passed through, since there is no side-effect-free way to verify it", () => {
    const pending = Promise.resolve("password");

    const result = redact({ pending }, policy) as { pending: unknown };

    expect(result.pending).not.toBe(pending);
    expect(result.pending).toEqual({});
  });

  test("primitives and null are returned unchanged", () => {
    expect(redact("password", policy)).toBe("password");
    expect(redact(42n, policy)).toBe(42n);
    expect(redact(null, policy)).toBeNull();
    expect(redact(undefined, policy)).toBeUndefined();
  });
});

describe("Error", () => {
  class TokenError extends Error {
    readonly code = "E_TOKEN";
    readonly token = "abc";
    readonly details = { password: "x", attempt: 3 };
  }

  test("name, message and stack survive and custom fields are redacted like any other field", () => {
    const error = new TokenError("token rejected");

    const result = redact(error, policy) as Record<string, unknown>;

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result).toEqual({
      name: "Error",
      message: "token rejected",
      stack: error.stack,
      code: "E_TOKEN",
      token: "[REDACTED]",
      details: { password: "[REDACTED]", attempt: 3 },
    });
    expect(Object.hasOwn(result, "cause")).toBe(false);
  });

  test("a cause is present in the copy and is itself redacted", () => {
    const root = new TokenError("root");
    const error = new Error("wrapped", { cause: root });

    const result = redact(error, policy) as Record<string, unknown>;

    expect(result.message).toBe("wrapped");
    expect(result.cause).toEqual({
      name: "Error",
      message: "root",
      stack: root.stack,
      code: "E_TOKEN",
      token: "[REDACTED]",
      details: { password: "[REDACTED]", attempt: 3 },
    });
  });

  test("a cause that is a plain value or undefined is carried over", () => {
    expect((redact(new Error("a", { cause: { secret: 1 } }), policy) as Record<string, unknown>).cause).toEqual({ secret: "[REDACTED]" });
    const result = redact(new Error("b", { cause: undefined }), policy) as Record<string, unknown>;
    expect(Object.hasOwn(result, "cause")).toBe(true);
    expect(result.cause).toBeUndefined();
  });

  test("a cause assigned directly, which makes it enumerable, is redacted exactly once", () => {
    const error = new Error("wrapped");
    error.cause = { token: "abc" };

    const replacement = vi.fn(() => "[REDACTED]");
    const result = redact(error, policy, { replacement }) as Record<string, unknown>;

    expect(replacement).toHaveBeenCalledExactlyOnceWith("abc", "token");
    expect(result.cause).toEqual({ token: "[REDACTED]" });
  });
});

describe("cross-realm builtins", () => {
  // A value built in another realm (an iframe, a worker) fails `instanceof` here, since it was
  // constructed from a different realm's Date/Map/Set/Error, even though it carries the same
  // internal tag `Object.prototype.toString` reads and the same methods, inherited from that
  // realm's own equivalent prototype. Standing in a copy of the real prototype's own properties,
  // under a distinct object identity, reproduces that same mismatch — instanceof fails, the tag
  // and the methods don't — without needing an actual second realm.
  function asForeign<T extends object>(value: T, prototype: object): T {
    Object.setPrototypeOf(value, Object.create(Object.prototype, Object.getOwnPropertyDescriptors(prototype)));
    return value;
  }

  test("a foreign-realm Date fails instanceof here, but is still returned by reference", () => {
    const date = asForeign(new Date(0), Date.prototype);
    expect(date instanceof Date).toBe(false);

    expect(redact({ at: date }, policy)).toEqual({ at: date });
  });

  test("a foreign-realm Map fails instanceof here, but is still walked as a Map", () => {
    const map = asForeign(new Map<string, unknown>([["password", "x"]]), Map.prototype);
    expect(map instanceof Map).toBe(false);

    expect(redact(map, policy)).toEqual(new Map([["password", "[REDACTED]"]]));
  });

  test("a foreign-realm Set fails instanceof here, but is still walked as a Set", () => {
    const set = asForeign(new Set([{ password: "x" }]), Set.prototype);
    expect(set instanceof Set).toBe(false);

    expect(redact(set, policy)).toEqual(new Set([{ password: "[REDACTED]" }]));
  });

  test("a foreign-realm Error fails instanceof here, but its name/message/stack still survive", () => {
    const error = asForeign(new Error("boom"), Error.prototype);
    expect(error instanceof Error).toBe(false);

    const result = redact(error, policy) as Record<string, unknown>;

    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
    expect(typeof result.stack).toBe("string");
  });
});

describe("spoofed builtin tags", () => {
  test("a class instance faking a Date's Symbol.toStringTag is walked as a plain instance, not passed through unredacted", () => {
    class FakeDate {
      readonly password = "x";
      get [Symbol.toStringTag]() {
        return "Date";
      }
    }
    const fake = new FakeDate();
    expect(Object.prototype.toString.call(fake)).toBe("[object Date]");

    expect(redact(fake, policy)).toEqual({ password: "[REDACTED]" });
  });

  test("a class instance faking a Map's Symbol.toStringTag is walked as a plain instance instead of thrown on or bypassed", () => {
    class FakeMap {
      readonly password = "x";
      get [Symbol.toStringTag]() {
        return "Map";
      }
    }
    const fake = new FakeMap();
    expect(Object.prototype.toString.call(fake)).toBe("[object Map]");

    expect(() => redact(fake, policy)).not.toThrow();
    expect(redact(fake, policy)).toEqual({ password: "[REDACTED]" });
  });

  test("a class instance faking a Set's Symbol.toStringTag is walked as a plain instance instead of thrown on or bypassed", () => {
    class FakeSet {
      readonly password = "x";
      get [Symbol.toStringTag]() {
        return "Set";
      }
    }
    const fake = new FakeSet();
    expect(Object.prototype.toString.call(fake)).toBe("[object Set]");

    expect(() => redact(fake, policy)).not.toThrow();
    expect(redact(fake, policy)).toEqual({ password: "[REDACTED]" });
  });
});

describe("null-prototype objects", () => {
  test("are walked as plain objects and copied into a plain object", () => {
    const input = Object.assign(Object.create(null) as Record<string, unknown>, { id: 1, password: "x" });

    const result = redact(input, policy);

    expect(result).toEqual({ id: 1, password: "[REDACTED]" });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe("immutability", () => {
  test("the input is never mutated", () => {
    const input = {
      user: { name: "ada", password: "x", tokens: ["a", { token: "b" }] },
      sessions: new Map<string, unknown>([
        ["secret", { id: 1 }],
        ["other", { password: "y" }],
      ]),
      tags: new Set([{ secret: "z" }]),
      created: new Date(0),
    };
    const snapshot = structuredClone(input);

    redact(input, policy);

    expect(input).toEqual(snapshot);
  });
});

/** `{ child: { child: … { leaf: true } } }`, `levels` containers deep, built without recursion. */
function nest(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let level = 1; level < levels; level++) value = { child: value };
  return value;
}

/** Follows `child` `steps` times. */
function descend(value: unknown, steps: number): unknown {
  let current = value;
  for (let step = 0; step < steps; step++) current = (current as Record<string, unknown>).child;
  return current;
}

describe("depth limit", () => {
  test("by default six levels of containers are kept and the seventh is [Truncated], however deep the input", () => {
    const result = redact(nest(100_000), policy);

    expect(descend(result, 5)).toEqual({ child: "[Truncated]" });
  });

  test("the input itself is the first level, and a container past maxDepth is replaced whole", () => {
    expect(redact({ a: { b: { c: 1 } } }, policy, { maxDepth: 2 })).toEqual({ a: { b: "[Truncated]" } });
    expect(redact({ a: 1 }, policy, { maxDepth: 0 })).toBe("[Truncated]");
  });

  test("only containers count: primitives and pass-through values past the limit are kept", () => {
    const date = new Date(0);

    expect(redact({ n: 1, s: "x", date, nested: {} }, policy, { maxDepth: 1 })).toEqual({ n: 1, s: "x", date, nested: "[Truncated]" });
  });

  test("arrays, Maps, Sets and Errors are each a level", () => {
    const limited = { maxDepth: 1 };

    expect(redact([[1]], policy, limited)).toEqual(["[Truncated]"]);
    expect(redact(new Map([["a", [1]]]), policy, limited)).toEqual(new Map([["a", "[Truncated]"]]));
    expect(redact(new Set([[1]]), policy, limited)).toEqual(new Set(["[Truncated]"]));
    expect(redact({ error: new Error("boom") }, policy, limited)).toEqual({ error: "[Truncated]" });
    const error = redact(new Error("boom", { cause: { id: 1 } }), policy, limited) as Record<string, unknown>;
    expect(error.message).toBe("boom");
    expect(error.cause).toBe("[Truncated]");
  });

  test("Infinity keeps every level", () => {
    const result = redact(nest(50), policy, { maxDepth: Number.POSITIVE_INFINITY });

    expect(descend(result, 49)).toEqual({ leaf: true });
  });

  test("NaN disables the limit", () => {
    expect(descend(redact(nest(20), policy, { maxDepth: Number.NaN }), 19)).toEqual({ leaf: true });
  });

  test("a reference back to an ancestor at the depth limit is [Circular], not [Truncated]", () => {
    const input: Record<string, unknown> = { id: 1 };
    input.self = input;
    input.other = {};

    expect(redact(input, policy, { maxDepth: 1 })).toEqual({ id: 1, self: "[Circular]", other: "[Truncated]" });
  });
});

describe("depth limit and matched keys", () => {
  test("a matched key's container value past maxDepth is still replaced, not truncated", () => {
    const token = { raw: { deeper: "abc" } };
    const replacement = vi.fn(() => "[REDACTED]");

    const result = redact({ session: { token } }, policy, { maxDepth: 2, replacement });

    expect(result).toEqual({ session: { token: "[REDACTED]" } });
    expect(replacement).toHaveBeenCalledExactlyOnceWith(token, "token");
  });

  test("a replacement's output is neither walked nor bounded", () => {
    const long = "x".repeat(20);
    const output = { a: { b: { c: long } } };

    const result = redact({ secret: 1 }, policy, { maxDepth: 1, maxStringLength: 4, replacement: () => output });

    expect((result as Record<string, unknown>).secret).toBe(output);
  });

  test("a key inside a container past maxDepth is never read, so a replacement function is called fewer times", () => {
    const input = { a: { password: "x" }, b: { token: "y" } };
    const bounded = vi.fn(() => "[REDACTED]");
    const unbounded = vi.fn(() => "[REDACTED]");

    expect(redact(input, policy, { maxDepth: 1, replacement: bounded })).toEqual({ a: "[Truncated]", b: "[Truncated]" });
    redact(input, policy, { maxDepth: Number.POSITIVE_INFINITY, replacement: unbounded });

    expect(bounded).not.toHaveBeenCalled();
    expect(unbounded).toHaveBeenCalledTimes(2);
  });
});

describe("breadth limit", () => {
  function fields(count: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (let index = 0; index < count; index++) out[`k${index}`] = index;
    return out;
  }

  test("by default an object keeps 100 fields and summarises the rest under the key …", () => {
    const result = redact(fields(105), policy) as Record<string, unknown>;

    expect(Object.keys(result)).toHaveLength(101);
    expect(result.k99).toBe(99);
    expect(Object.hasOwn(result, "k100")).toBe(false);
    expect(result["…"]).toBe("[Truncated: 5 more]");
  });

  test("an object exactly at the limit carries no marker, and an own toJSON does not count toward it", () => {
    const input = { ...fields(2), toJSON: () => "leak" };

    expect(redact(input, policy, { maxBreadth: 2 })).toEqual({ k0: 0, k1: 1 });
  });

  test("by default an array keeps 100 items and appends a marker item", () => {
    const result = redact(
      Array.from({ length: 103 }, (_, index) => index),
      policy,
    ) as unknown[];

    expect(result).toHaveLength(101);
    expect(result[99]).toBe(99);
    expect(result[100]).toBe("[Truncated: 3 more]");
  });

  test("a Map keeps its first maxBreadth entries and stays a Map, with the marker under the key …", () => {
    const input = new Map<unknown, unknown>([
      [1, "a"],
      ["password", "b"],
      ["c", "c"],
    ]);

    const result = redact(input, policy, { maxBreadth: 2 });

    expect(result).toEqual(
      new Map<unknown, unknown>([
        [1, "a"],
        ["password", "[REDACTED]"],
        ["…", "[Truncated: 1 more]"],
      ]),
    );
  });

  test("a Set keeps its first maxBreadth members and stays a Set, with a marker member", () => {
    expect(redact(new Set([1, 2, 3, 4]), policy, { maxBreadth: 2 })).toEqual(new Set([1, 2, "[Truncated: 2 more]"]));
  });

  test("a Set whose kept member equals the marker still ends with a marker member, raised to #1, #2", () => {
    const marker = "[Truncated: 1 more]";

    expect(redact(new Set([marker, 2]), policy, { maxBreadth: 1 })).toEqual(new Set([marker, `${marker}#1`]));
    expect(redact(new Set([marker, `${marker}#1`, 3]), policy, { maxBreadth: 2 })).toEqual(new Set([marker, `${marker}#1`, `${marker}#2`]));
  });

  test("an Error always keeps name, message, stack and cause, and bounds only its other own fields", () => {
    class DetailedError extends Error {
      readonly first = 1;
      readonly second = 2;
      readonly third = 3;
    }
    const error = new DetailedError("boom", { cause: "root" });

    const result = redact(error, policy, { maxBreadth: 1 });

    expect(result).toEqual({ name: "Error", message: "boom", stack: error.stack, cause: "root", first: 1, "…": "[Truncated: 2 more]" });
  });

  test("the marker key is raised to …#1, …#2 when kept keys already hold it", () => {
    expect(redact({ "…": 1, "…#1": 2, other: 3 }, policy, { maxBreadth: 2 })).toEqual({ "…": 1, "…#1": 2, "…#2": "[Truncated: 1 more]" });
    expect(
      redact(
        new Map([
          ["…", 1],
          ["x", 2],
        ]),
        policy,
        { maxBreadth: 1 },
      ),
    ).toEqual(
      new Map<string, unknown>([
        ["…", 1],
        ["…#1", "[Truncated: 1 more]"],
      ]),
    );
  });

  test("a Map and a Set are pulled from only up to maxBreadth entries", () => {
    const entries = Array.from({ length: 1000 }, (_, index): [string, number] => [`k${index}`, index]);
    let pulledFromMap = 0;
    let pulledFromSet = 0;
    const map = new Map(entries);
    const set = new Set(entries.map(([key]) => key));
    const mapIterator = map[Symbol.iterator].bind(map);
    const setIterator = set[Symbol.iterator].bind(set);
    map[Symbol.iterator] = function* () {
      for (const entry of mapIterator()) {
        pulledFromMap++;
        yield entry;
      }
      return undefined;
    };
    set[Symbol.iterator] = function* () {
      for (const item of setIterator()) {
        pulledFromSet++;
        yield item;
      }
      return undefined;
    };

    const redactedMap = redact(map, policy, { maxBreadth: 2 }) as Map<unknown, unknown>;
    const redactedSet = redact(set, policy, { maxBreadth: 2 }) as Set<unknown>;

    expect(pulledFromMap).toBeLessThanOrEqual(3);
    expect(pulledFromSet).toBeLessThanOrEqual(3);
    expect(redactedMap.get("…")).toBe("[Truncated: 998 more]");
    expect(redactedSet.has("[Truncated: 998 more]")).toBe(true);
  });

  test("Infinity and NaN keep every entry", () => {
    const items = Array.from({ length: 150 }, (_, index) => index);

    expect(redact(items, policy, { maxBreadth: Number.POSITIVE_INFINITY })).toEqual(items);
    expect(redact(items, policy, { maxBreadth: Number.NaN })).toEqual(items);
  });
});

describe("string length limit", () => {
  const limited = { maxStringLength: 4 };
  const cut = `abcd${STRING_TRUNCATION_SUFFIX}`;

  test("by default a string is cut at 8192 characters and suffixed", () => {
    expect(redact("x".repeat(8192), policy)).toBe("x".repeat(8192));
    expect(redact("x".repeat(8193), policy)).toBe(`${"x".repeat(8192)}${STRING_TRUNCATION_SUFFIX}`);
  });

  test("every walked string value is cut: fields, items, members and Map values", () => {
    expect(redact({ s: "abcdef" }, policy, limited)).toEqual({ s: cut });
    expect(redact(["abcdef"], policy, limited)).toEqual([cut]);
    expect(redact(new Set(["abcdef"]), policy, limited)).toEqual(new Set([cut]));
    expect(redact(new Map([["k", "abcdef"]]), policy, limited)).toEqual(new Map([["k", cut]]));
  });

  test("an Error's message and stack are cut", () => {
    const result = redact(new Error("abcdef"), policy, limited) as Record<string, unknown>;

    expect(result.message).toBe(cut);
    expect(result.stack).toMatch(/^.{4}…\[truncated\]$/su);
  });

  test("keys are never cut, in objects or Maps", () => {
    expect(redact({ abcdef: 1 }, policy, limited)).toEqual({ abcdef: 1 });
    expect(redact(new Map([["abcdef", 1]]), policy, limited)).toEqual(new Map([["abcdef", 1]]));
  });

  test("a matched key's replacement is not cut", () => {
    expect(redact({ password: "x" }, policy, { ...limited, replacement: "[REDACTED]" })).toEqual({ password: "[REDACTED]" });
  });
});
