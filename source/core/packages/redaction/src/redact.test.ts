import { describe, expect, test, vi } from "vitest";
import type { RedactionPolicy } from "./key-matcher";
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
