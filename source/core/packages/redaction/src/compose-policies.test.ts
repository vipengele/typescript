import { describe, expect, test } from "vitest";
import { composePolicies } from "./compose-policies";
import type { RedactionPolicy } from "./key-matcher";
import { matchKey } from "./key-matcher";
import { redact } from "./redact";
import { secretKeys } from "./secret-keys";

describe("composePolicies", () => {
  test("combines secretKeys with extra keys and an exemption end to end", () => {
    const policy = composePolicies(secretKeys, { keys: ["ssn"], except: ["tokenCount"] });

    expect(redact({ password: "x", ssn: "1", tokenCount: 3, name: "ada" }, policy)).toEqual({
      password: "[REDACTED]",
      ssn: "[REDACTED]",
      tokenCount: 3,
      name: "ada",
    });
  });

  test("returns a new object, not one of the parts", () => {
    const part: RedactionPolicy = { keys: ["a"] };

    expect(composePolicies(part)).not.toBe(part);
    expect(composePolicies(secretKeys)).not.toBe(secretKeys);
  });

  test("leaves its inputs untouched", () => {
    const first: RedactionPolicy = { keys: ["a"], except: ["b"] };
    const second: RedactionPolicy = Object.freeze({ keys: Object.freeze(["c"]) });
    const snapshot = structuredClone([first, second]);

    composePolicies(first, second);

    expect([first, second]).toEqual(snapshot);
    expect(second.except).toBeUndefined();
  });

  test("an empty call yields a frozen policy that matches nothing", () => {
    const policy = composePolicies();

    expect(policy.keys).toEqual([]);
    expect(policy.except).toEqual([]);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(matchKey(policy, "password")).toBe(false);
  });

  test("concatenates keys and except across parts in order", () => {
    const policy = composePolicies({ keys: ["a"], except: ["x"] }, { keys: ["b", "c"] }, { keys: [], except: ["y"] });

    expect(policy.keys).toEqual(["a", "b", "c"]);
    expect(policy.except).toEqual(["x", "y"]);
  });

  test("an exemption from one part applies to keys matched by another", () => {
    const policy = composePolicies({ keys: ["a"] }, { keys: [], except: ["a"] });

    expect(matchKey(policy, "a")).toBe(false);
  });

  test("the result and its arrays are frozen", () => {
    const policy = composePolicies({ keys: ["a"], except: ["b"] });

    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.keys)).toBe(true);
    expect(Object.isFrozen(policy.except)).toBe(true);
    expect(() => {
      (policy.keys as unknown[]).push("z");
    }).toThrow(TypeError);
  });

  test("mutating an input array afterwards does not affect the result", () => {
    const keys = ["a"];
    const except: string[] = [];
    const policy = composePolicies({ keys, except });

    keys.push("b");
    except.push("a");

    expect(policy.keys).toEqual(["a"]);
    expect(policy.except).toEqual([]);
    expect(matchKey(policy, "a")).toBe(true);
    expect(matchKey(policy, "b")).toBe(false);
  });
});
