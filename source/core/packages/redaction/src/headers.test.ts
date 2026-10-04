// biome-ignore-all lint/security/noSecrets: every fixture is a header value, flagged only for its entropy
import { afterEach, describe, expect, test, vi } from "vitest";
import { type HeaderRecord, type HeaderTuples, redactHeaders } from "./headers";
import type { RedactionPolicy } from "./key-matcher";
import { STRING_TRUNCATION_SUFFIX } from "./limits";

function headersOf(...pairs: [string, string][]): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) headers.append(name, value);
  return headers;
}

describe("Headers input", () => {
  test("returns a new Headers with every secretKeys header replaced whole and the rest kept", () => {
    const input = headersOf(["Authorization", "Bearer abc"], ["Cookie", "a=1; b=2"], ["X-Api-Key", "k-123"], ["Accept", "text/html"]);
    const out = redactHeaders(input);
    expect(out).toBeInstanceOf(Headers);
    expect(out).not.toBe(input);
    expect([...out]).toEqual([
      ["accept", "text/html"],
      ["authorization", "[REDACTED]"],
      ["cookie", "[REDACTED]"],
      ["x-api-key", "[REDACTED]"],
    ]);
  });

  test("replaces each Set-Cookie entry on its own, a comma inside a cookie included", () => {
    const input = headersOf(["Set-Cookie", "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT"], ["Set-Cookie", "b=2"]);
    const out = redactHeaders(input);
    expect(out.getSetCookie()).toEqual(["[REDACTED]", "[REDACTED]"]);
  });

  test("a function replacement receives each cookie and the key set-cookie, and lower-cased names", () => {
    const replacement = vi.fn((value: unknown, key: string) => `${key}:${String(value).length}`);
    const input = headersOf(["Set-Cookie", "a=1"], ["Set-Cookie", "bb=22"], ["Authorization", "Basic x"]);
    const out = redactHeaders(input, { replacement });
    expect(replacement.mock.calls).toEqual([
      ["Basic x", "authorization"],
      ["a=1", "set-cookie"],
      ["bb=22", "set-cookie"],
    ]);
    expect(out.get("authorization")).toBe("authorization:7");
    expect(out.getSetCookie()).toEqual(["set-cookie:3", "set-cookie:5"]);
  });

  test("a non-string replacement is converted with String()", () => {
    const out = redactHeaders(headersOf(["Authorization", "x"]), { replacement: () => 42 });
    expect(out.get("authorization")).toBe("42");
  });

  test("a policy is matched against the lower-cased name", () => {
    const input = headersOf(["X-Trace", "t"]);
    expect(redactHeaders(input, { policy: { keys: ["X-Trace"] } }).get("x-trace")).toBe("t");
    expect(redactHeaders(input, { policy: { keys: ["x-trace"] } }).get("x-trace")).toBe("[REDACTED]");
  });

  test("never mutates the input", () => {
    const input = headersOf(["Authorization", "Bearer abc"], ["Set-Cookie", "a=1"]);
    redactHeaders(input, { maxBreadth: 0 });
    expect([...input]).toEqual([
      ["authorization", "Bearer abc"],
      ["set-cookie", "a=1"],
    ]);
  });

  test("keeps maxBreadth entries, each Set-Cookie counted, and a ... marker for the rest", () => {
    const input = headersOf(["Accept", "a"], ["Set-Cookie", "c=1"], ["Set-Cookie", "c=2"], ["X-Z", "z"]);
    expect([...redactHeaders(input, { maxBreadth: 2 })]).toEqual([
      ["...", "[Truncated: 2 more]"],
      ["accept", "a"],
      ["set-cookie", "[REDACTED]"],
    ]);
  });

  test("the breadth marker name is made unique against a kept ... header", () => {
    const input = headersOf(["...", "real"], ["X-A", "a"]);
    const out = redactHeaders(input, { maxBreadth: 1 });
    expect(out.get("...")).toBe("real");
    expect(out.get("...#1")).toBe("[Truncated: 1 more]");
  });

  test("a value the Headers cannot carry is stored as [REDACTED]", () => {
    const long = redactHeaders(headersOf(["Accept", "abcdef"]), { maxStringLength: 3 });
    expect(long.get("accept")).toBe("[REDACTED]");
    const latin = redactHeaders(headersOf(["Authorization", "x"]), { replacement: "███" });
    expect(latin.get("authorization")).toBe("[REDACTED]");
    expect(redactHeaders(headersOf(["Accept", "abc"]), { maxStringLength: 3 }).get("accept")).toBe("abc");
  });
});

describe("record input", () => {
  test("returns a new record, names as written, matched values replaced whole", () => {
    const input: HeaderRecord = { Authorization: "Bearer abc", "content-type": "application/json" };
    const out = redactHeaders(input);
    expect(out).not.toBe(input);
    expect(out).toEqual({ Authorization: "[REDACTED]", "content-type": "application/json" });
    expect(input).toEqual({ Authorization: "Bearer abc", "content-type": "application/json" });
  });

  test("names differing only in case are separate entries", () => {
    const policy: RedactionPolicy = { keys: ["Token"] };
    expect(redactHeaders({ Token: "a", token: "b" }, { policy })).toEqual({ Token: "[REDACTED]", token: "b" });
  });

  test("replaces each element of a list on its own and copies the list", () => {
    const cookies = ["a=1", "b=2"];
    const replacement = vi.fn((value: unknown) => `<${String(value)}>`);
    const out = redactHeaders({ "Set-Cookie": cookies, Accept: ["x", "y"] }, { replacement });
    expect(out).toEqual({ "Set-Cookie": ["<a=1>", "<b=2>"], Accept: ["x", "y"] });
    expect(out["Set-Cookie"]).not.toBe(cookies);
    expect(cookies).toEqual(["a=1", "b=2"]);
    expect(replacement.mock.calls).toEqual([
      ["a=1", "set-cookie"],
      ["b=2", "set-cookie"],
    ]);
  });

  test("a replacement receives a record name as written, except Set-Cookie", () => {
    const replacement = vi.fn(() => "r");
    redactHeaders({ "X-API-KEY": "k", "SET-COOKIE": "c" }, { replacement });
    expect(replacement.mock.calls).toEqual([
      ["k", "X-API-KEY"],
      ["c", "set-cookie"],
    ]);
  });

  test("keeps maxBreadth names, a list counting once, and a unique … key for the rest", () => {
    const out = redactHeaders({ "…": "real", Cookie: ["a", "b"], Accept: "x" }, { maxBreadth: 2 });
    expect(out).toEqual({ "…": "real", Cookie: ["[REDACTED]", "[REDACTED]"], "…#1": "[Truncated: 1 more]" });
  });

  test("bounds a list like an array, with a trailing marker element", () => {
    expect(redactHeaders({ Accept: ["a", "b", "c"] }, { maxBreadth: 2 })).toEqual({ Accept: ["a", "b", "[Truncated: 1 more]"] });
  });

  test("cuts every value and list element to maxStringLength after redaction", () => {
    const out = redactHeaders({ Accept: "abcdef", Cookie: ["x"], Via: ["123456"] }, { maxStringLength: 4 });
    expect(out).toEqual({
      Accept: `abcd${STRING_TRUNCATION_SUFFIX}`,
      Cookie: [`[RED${STRING_TRUNCATION_SUFFIX}`],
      Via: [`1234${STRING_TRUNCATION_SUFFIX}`],
    });
  });

  test("copies a __proto__ name as data", () => {
    const input = JSON.parse('{"__proto__": "x", "Cookie": "c"}') as HeaderRecord;
    const out = redactHeaders(input);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(["__proto__", "Cookie"]);
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toBe("x");
  });

  test("converts a value that is neither a string nor a list with String()", () => {
    const input = { Count: 3, Cookie: [7] } as unknown as HeaderRecord;
    expect(redactHeaders(input, { replacement: (value) => typeof value })).toEqual({ Count: "3", Cookie: ["string"] });
  });
});

describe("tuple input", () => {
  test("returns new pairs, names as written and order kept, matched values replaced whole", () => {
    const input: HeaderTuples = [
      ["Authorization", "Bearer abc"],
      ["Accept", "x"],
      ["Set-Cookie", "a=1"],
      ["Set-Cookie", "b=2"],
    ];
    const out = redactHeaders(input);
    expect(out).not.toBe(input);
    expect(out).toEqual([
      ["Authorization", "[REDACTED]"],
      ["Accept", "x"],
      ["Set-Cookie", "[REDACTED]"],
      ["Set-Cookie", "[REDACTED]"],
    ]);
    expect(input[0]).toEqual(["Authorization", "Bearer abc"]);
  });

  test("a replacement receives the name as written, and set-cookie for a cookie", () => {
    const replacement = vi.fn(() => "r");
    redactHeaders(
      [
        ["X-Api-Key", "k"],
        ["Set-Cookie", "c"],
      ],
      { replacement },
    );
    expect(replacement.mock.calls).toEqual([
      ["k", "X-Api-Key"],
      ["c", "set-cookie"],
    ]);
  });

  test("keeps maxBreadth pairs and one trailing marker pair with a unique … name", () => {
    const input: HeaderTuples = [
      ["…", "real"],
      ["A", "1"],
      ["B", "2"],
    ];
    expect(redactHeaders(input, { maxBreadth: 1 })).toEqual([
      ["…", "real"],
      ["…#1", "[Truncated: 2 more]"],
    ]);
  });

  test("cuts every value to maxStringLength after redaction", () => {
    expect(redactHeaders([["Accept", "abcdef"]], { maxStringLength: 2 })).toEqual([["Accept", `ab${STRING_TRUNCATION_SUFFIX}`]]);
  });

  test("drops an entry that is not an array and converts a non-string name or value", () => {
    const input = [null, "Cookie", ["Cookie", 5], [1, 2], []] as unknown as HeaderTuples;
    expect(redactHeaders(input, { maxBreadth: 2 })).toEqual([
      ["Cookie", "[REDACTED]"],
      ["1", "2"],
      ["…", "[Truncated: 1 more]"],
    ]);
  });
});

describe("other input", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a custom policy replaces secretKeys entirely", () => {
    expect(redactHeaders({ "X-Sig": "s", Authorization: "a" }, { policy: { keys: ["X-Sig"] } })).toEqual({
      "X-Sig": "[REDACTED]",
      Authorization: "a",
    });
  });

  test("input that is none of the three kinds returns an empty record", () => {
    expect(redactHeaders(null as unknown as HeaderRecord)).toEqual({});
    expect(redactHeaders("Cookie: x" as unknown as HeaderRecord)).toEqual({});
  });

  test("a realm with no Headers class reads every object as a record", () => {
    vi.stubGlobal("Headers", undefined);
    expect(redactHeaders({ Cookie: "c" })).toEqual({ Cookie: "[REDACTED]" });
  });
});
