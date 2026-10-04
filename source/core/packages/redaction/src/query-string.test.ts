// biome-ignore-all lint/security/noSecrets: every fixture is a query string, flagged only for its entropy
import { describe, expect, test, vi } from "vitest";
import type { RedactionPolicy } from "./key-matcher";
import { STRING_TRUNCATION_SUFFIX } from "./limits";
import { redactParams, redactQueryString, resolveStringOptions } from "./query-string";
import { secretKeys } from "./secret-keys";

describe("matching", () => {
  test("redacts the value of a parameter secretKeys matches by default and keeps the rest", () => {
    expect(redactQueryString("?user=ada&access_token=abc123&page=2")).toBe("?user=ada&access_token=[REDACTED]&page=2");
  });

  test("accepts a query with no leading ?, and keeps only the one ? it was given", () => {
    expect(redactQueryString("password=x&id=1")).toBe("password=[REDACTED]&id=1");
    expect(redactQueryString("??password=x", { policy: { keys: ["password"] } })).toBe("??password=x");
  });

  test("a custom policy replaces secretKeys entirely", () => {
    const policy: RedactionPolicy = { keys: ["sig"] };
    expect(redactQueryString("?sig=abc&token=t", { policy })).toBe("?sig=[REDACTED]&token=t");
  });

  test("a policy's exceptions are honoured", () => {
    const policy: RedactionPolicy = { keys: [{ segments: "token" }], except: ["token_type"] };
    expect(redactQueryString("token_type=bearer&id_token=x", { policy })).toBe("token_type=bearer&id_token=[REDACTED]");
  });

  test("every occurrence of a repeated name is redacted", () => {
    expect(redactQueryString("?token=a&id=1&token=b&token=c")).toBe("?token=[REDACTED]&id=1&token=[REDACTED]&token=[REDACTED]");
  });

  test("an empty value under a matched name is still replaced", () => {
    expect(redactQueryString("?token=&id=")).toBe("?token=[REDACTED]&id=");
  });

  test("a value is split at the first = only", () => {
    expect(redactQueryString("token=a=b&q=c=d")).toBe("token=[REDACTED]&q=c=d");
  });

  test("a segment with no = has no value and is kept whole, whatever its name", () => {
    expect(redactQueryString("?token&password&%zz&id=1")).toBe("?token&password&%zz&id=1");
  });

  test("an empty name is matched as the empty string", () => {
    expect(redactQueryString("=x", { policy: { keys: [""] } })).toBe("=[REDACTED]");
    expect(redactQueryString("=x")).toBe("=x");
  });
});

describe("decoding", () => {
  test("a name is percent-decoded before matching, and its escapes are kept as written", () => {
    expect(redactQueryString("?access%5Ftoken=x&%70assword=y")).toBe("?access%5Ftoken=[REDACTED]&%70assword=[REDACTED]");
  });

  test("a + in a name is a space before matching", () => {
    const policy: RedactionPolicy = { keys: ["api key"] };
    expect(redactQueryString("api+key=x&api%20key=y&apikey=z", { policy })).toBe("api+key=[REDACTED]&api%20key=[REDACTED]&apikey=z");
  });

  test("a + in a name is not percent-decoded into a literal +", () => {
    const policy: RedactionPolicy = { keys: ["a+b"] };
    expect(redactQueryString("a+b=x&a%2Bb=y", { policy })).toBe("a+b=x&a%2Bb=[REDACTED]");
  });

  test("a name with a malformed escape is redacted, whatever the policy", () => {
    const policy: RedactionPolicy = { keys: [] };
    expect(redactQueryString("%zz=x&ok=1", { policy })).toBe("%zz=[REDACTED]&ok=1");
    expect(redactQueryString("trailing%=x&%4=y", { policy })).toBe("trailing%=[REDACTED]&%4=[REDACTED]");
  });

  test("a name whose escapes are not valid UTF-8 is redacted", () => {
    expect(redactQueryString("%C3=x&%ED%A0%80=y&%C3%A9=z")).toBe("%C3=[REDACTED]&%ED%A0%80=[REDACTED]&%C3%A9=z");
  });

  test("a value under an unmatched name is kept byte for byte, malformed escapes included", () => {
    const query = "?q=a+b%20c~!%2B&bad=%zz&x=%";
    expect(redactQueryString(query)).toBe(query);
  });
});

describe("replacement", () => {
  test("a string replacement is used in place of the default", () => {
    expect(redactQueryString("token=x", { replacement: "***" })).toBe("token=***");
  });

  test("a function replacement receives the decoded value and the decoded name", () => {
    const replacement = vi.fn((value: unknown, key: string) => `<${key}|${String(value)}>`);

    const result = redactQueryString("?access%5Ftoken=a+b%2Fc&id=1", { replacement });

    expect(replacement).toHaveBeenCalledExactlyOnceWith("a b/c", "access_token");
    expect(result).toBe("?access%5Ftoken=<access_token|a b/c>&id=1");
  });

  test("a function replacement receives the raw value when the value cannot be decoded", () => {
    const replacement = vi.fn(() => "R");

    redactQueryString("token=%zz+1", { replacement });

    expect(replacement).toHaveBeenCalledExactlyOnceWith("%zz+1", "token");
  });

  test("a function replacement receives the raw name when the name cannot be decoded", () => {
    const replacement = vi.fn(() => "R");

    expect(redactQueryString("%zz+a=v%20w", { replacement })).toBe("%zz+a=R");
    expect(replacement).toHaveBeenCalledExactlyOnceWith("v w", "%zz+a");
  });

  test("a non-string return is converted with String()", () => {
    expect(
      redactQueryString("token=x&secret=y&password=z", { replacement: (value) => (value === "x" ? 42 : value === "y" ? null : undefined) }),
    ).toBe("token=42&secret=null&password=undefined");
  });

  test("the replacement is written as returned, without percent-encoding", () => {
    expect(redactQueryString("token=x&id=1", { replacement: "a b&c" })).toBe("token=a b&c&id=1");
  });

  test("the replacement is not called for an unmatched parameter", () => {
    const replacement = vi.fn(() => "R");

    redactQueryString("id=1&page=2", { replacement });

    expect(replacement).not.toHaveBeenCalled();
  });
});

describe("structure", () => {
  test("empty input stays empty, with or without a ?", () => {
    expect(redactQueryString("")).toBe("");
    expect(redactQueryString("?")).toBe("?");
  });

  test("empty segments, a trailing & and a leading & are kept", () => {
    expect(redactQueryString("?&token=x&&id=1&")).toBe("?&token=[REDACTED]&&id=1&");
  });

  test("a fragment-looking # is part of the value it follows", () => {
    expect(redactQueryString("token=x#y&id=1")).toBe("token=[REDACTED]&id=1");
    expect(redactQueryString("id=1#token=x")).toBe("id=1#token=x");
  });

  test("the input is not mutated, and the function does not throw on arbitrary text", () => {
    const inputs = ["%", "&&&", "===", "?=&=", "%%%=%%%", "\u{1F600}=\u{1F600}", "a=\uD800"];
    for (const input of inputs) {
      expect(() => redactQueryString(input)).not.toThrow();
    }
    expect(redactQueryString("%%%=%%%")).toBe("%%%=[REDACTED]");
  });
});

describe("maxBreadth", () => {
  test("parameters past maxBreadth are dropped and summarised by one marker segment", () => {
    expect(redactQueryString("?a=1&token=x&c=3&d=4", { maxBreadth: 2 })).toBe("?a=1&token=[REDACTED]&[Truncated: 2 more]");
  });

  test("empty segments are not counted, and those before the first dropped parameter are dropped with it", () => {
    expect(redactQueryString("&a=1&&b=2&&c=3", { maxBreadth: 2 })).toBe("&a=1&&b=2&[Truncated: 1 more]");
  });

  test("a query of exactly maxBreadth parameters is kept whole, trailing empty segments included", () => {
    expect(redactQueryString("a=1&b=2&&", { maxBreadth: 2 })).toBe("a=1&b=2&&");
  });

  test("maxBreadth 0 keeps only the marker", () => {
    expect(redactQueryString("?a=1&b=2", { maxBreadth: 0 })).toBe("?[Truncated: 2 more]");
    expect(redactQueryString("&&", { maxBreadth: 0 })).toBe("&&");
  });

  test("maxBreadth is floored and clamped at 0", () => {
    expect(redactQueryString("a=1&b=2&c=3", { maxBreadth: 1.9 })).toBe("a=1&[Truncated: 2 more]");
    expect(redactQueryString("a=1", { maxBreadth: -3 })).toBe("[Truncated: 1 more]");
  });

  test("NaN and Infinity keep every parameter", () => {
    const query = Array.from({ length: 150 }, (_, index) => `p${index}=${index}`).join("&");
    expect(redactQueryString(query, { maxBreadth: Number.NaN })).toBe(query);
    expect(redactQueryString(query, { maxBreadth: Number.POSITIVE_INFINITY })).toBe(query);
  });

  test("defaults to 100 parameters", () => {
    const query = Array.from({ length: 103 }, (_, index) => `p${index}=${index}`).join("&");
    const result = redactQueryString(query);
    expect(result.split("&")).toHaveLength(101);
    expect(result.endsWith("&p99=99&[Truncated: 3 more]")).toBe(true);
  });

  test("a dropped parameter's value is never passed to the replacement", () => {
    const replacement = vi.fn(() => "R");

    redactQueryString("token=a&token=b", { replacement, maxBreadth: 1 });

    expect(replacement).toHaveBeenCalledExactlyOnceWith("a", "token");
  });
});

describe("maxStringLength", () => {
  test("the redacted result is cut, the ? counting toward the length", () => {
    expect(redactQueryString("?token=abcdefghijklmnop&id=1", { maxStringLength: 10 })).toBe(`?token=[RE${STRING_TRUNCATION_SUFFIX}`);
  });

  test("redaction happens before truncation, so a secret near the cut never leaks", () => {
    expect(redactQueryString("token=hunter2", { maxStringLength: 9, replacement: "*" })).toBe("token=*");
  });

  test("defaults to 8192 code units", () => {
    const query = `q=${"a".repeat(9000)}`;
    expect(redactQueryString(query)).toBe(`${query.slice(0, 8192)}${STRING_TRUNCATION_SUFFIX}`);
  });

  test("NaN and Infinity keep the whole result", () => {
    const query = `q=${"a".repeat(9000)}`;
    expect(redactQueryString(query, { maxStringLength: Number.NaN })).toBe(query);
    expect(redactQueryString(query, { maxStringLength: Number.POSITIVE_INFINITY })).toBe(query);
  });
});

describe("resolveStringOptions and redactParams", () => {
  test("fills in secretKeys, the default replacement and the limits.ts defaults", () => {
    expect(resolveStringOptions()).toEqual({
      policy: secretKeys,
      replacement: "[REDACTED]",
      limits: { maxDepth: 6, maxBreadth: 100, maxStringLength: 8192 },
    });
  });

  test("keeps every option given", () => {
    const policy: RedactionPolicy = { keys: ["x"] };
    const replacement = (): string => "R";
    expect(resolveStringOptions({ policy, replacement, maxBreadth: 3, maxStringLength: 4 })).toEqual({
      policy,
      replacement,
      limits: { maxDepth: 6, maxBreadth: 3, maxStringLength: 4 },
    });
  });

  test("redactParams treats a leading ? as part of the first name and never truncates", () => {
    const options = resolveStringOptions({ policy: { keys: ["token"] }, maxStringLength: 3 });
    expect(redactParams("?token=x&token=y", options)).toBe("?token=x&token=[REDACTED]");
  });
});
