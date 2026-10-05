// biome-ignore-all lint/security/noSecrets: every fixture is a made-up card number or token, flagged only for its entropy
import { describe, expect, test } from "vitest";
import { redactHeaders } from "./headers";
import type { RedactionPolicy } from "./key-matcher";
import { maskKeepLast } from "./mask";
import { redactQueryString } from "./query-string";
import { redact } from "./redact";
import { applyReplacement, type Replacement } from "./replacement";
import { redactUrl } from "./url";

const CARD = "4242424242424242";

function mask(replacement: Replacement, value: unknown): unknown {
  return applyReplacement(replacement, value, "card");
}

describe("shape", () => {
  test("keeps the last `keep` code units behind a run of four mask characters and a space", () => {
    expect(mask(maskKeepLast(4), CARD)).toBe("**** 4242");
  });

  test("the run is four characters whatever the value's length, so the length never leaks", () => {
    expect(mask(maskKeepLast(2), "abcdef")).toBe("**** ef");
    expect(mask(maskKeepLast(2), "a".repeat(1000))).toBe("**** aa");
  });

  test("a value one code unit longer than `keep` keeps exactly `keep` of them", () => {
    expect(mask(maskKeepLast(4), "54242")).toBe("**** 4242");
  });

  test("a value no longer than `keep` is the bare run, with no tail", () => {
    expect(mask(maskKeepLast(4), "4242")).toBe("****");
    expect(mask(maskKeepLast(4), "42")).toBe("****");
  });

  test("an empty string is the bare run", () => {
    expect(mask(maskKeepLast(4), "")).toBe("****");
  });

  test("ignores the key it is called with", () => {
    const replacement = maskKeepLast(4);
    expect(applyReplacement(replacement, CARD, "a")).toBe(applyReplacement(replacement, CARD, "b"));
  });
});

describe("keep", () => {
  test.each([
    ["0", 0],
    ["-0", -0],
    ["a negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("%s masks the whole value rather than keeping all of it", (_, keep) => {
    expect(mask(maskKeepLast(keep), CARD)).toBe("****");
    expect(mask(maskKeepLast(keep), "")).toBe("****");
  });

  test("a fraction is floored", () => {
    expect(mask(maskKeepLast(1.5), CARD)).toBe("**** 2");
    expect(mask(maskKeepLast(0.5), CARD)).toBe("****");
  });

  test("a non-number from an untyped caller masks the whole value and does not throw", () => {
    expect(mask(maskKeepLast("4" as unknown as number), CARD)).toBe("****");
    expect(mask(maskKeepLast(undefined as unknown as number), CARD)).toBe("****");
  });
});

describe("UTF-16 code units", () => {
  test("a tail ending in a whole surrogate pair keeps it", () => {
    expect(mask(maskKeepLast(2), "card 😀")).toBe("**** 😀");
  });

  test("a tail cutting a surrogate pair keeps its lone low surrogate", () => {
    const out = mask(maskKeepLast(1), "card 😀");
    expect(out).toBe("**** \uDE00");
  });

  test("an astral character counts as two code units against `keep`", () => {
    expect(mask(maskKeepLast(2), "😀")).toBe("****");
  });
});

describe("non-string values", () => {
  test("a number masks the same as its string form", () => {
    const replacement = maskKeepLast(4);
    expect(mask(replacement, 4242424242424242)).toBe("**** 4242");
    expect(mask(replacement, 4242424242424242)).toBe(mask(replacement, "4242424242424242"));
  });

  test("a bigint and a boolean go through String()", () => {
    expect(mask(maskKeepLast(4), 12345678n)).toBe("**** 5678");
    expect(mask(maskKeepLast(2), true)).toBe("**** ue");
  });

  test("a symbol goes through String()", () => {
    expect(mask(maskKeepLast(3), Symbol("secret"))).toBe("**** et)");
  });

  test("null and undefined are primitives and go through String(), like every other primitive", () => {
    expect(mask(maskKeepLast(2), null)).toBe("**** ll");
    expect(mask(maskKeepLast(4), undefined)).toBe("**** ined");
    expect(mask(maskKeepLast(4), null)).toBe("****");
  });

  test.each([
    ["an object", { card: CARD }],
    ["an array", [CARD]],
    ["a function", () => CARD],
    ["a boxed string", new String(CARD)],
    ["a Date", new Date(0)],
  ])("%s is replaced by [REDACTED]", (_, value) => {
    expect(mask(maskKeepLast(4), value)).toBe("[REDACTED]");
  });
});

describe("maskChar", () => {
  test("replaces the default mask character", () => {
    expect(mask(maskKeepLast(4, { maskChar: "#" }), CARD)).toBe("#### 4242");
    expect(mask(maskKeepLast(0, { maskChar: "x" }), CARD)).toBe("xxxx");
  });

  test("only the first code point is used", () => {
    expect(mask(maskKeepLast(4, { maskChar: "#-" }), CARD)).toBe("#### 4242");
  });

  test("an astral first character is kept whole rather than split", () => {
    expect(mask(maskKeepLast(4, { maskChar: "😀x" }), CARD)).toBe("😀😀😀😀 4242");
  });

  test("an empty or non-string maskChar takes the default and does not throw", () => {
    expect(mask(maskKeepLast(4, { maskChar: "" }), CARD)).toBe("**** 4242");
    expect(mask(maskKeepLast(4, { maskChar: 7 as unknown as string }), CARD)).toBe("**** 4242");
    expect(mask(maskKeepLast(4, {}), CARD)).toBe("**** 4242");
  });
});

describe("as a replacement", () => {
  const policy: RedactionPolicy = { keys: ["card"] };

  test("masks a key-matched value inside redact, a number included, and an object under the key", () => {
    expect(redact({ card: CARD, other: CARD }, policy, { replacement: maskKeepLast(4) })).toEqual({
      card: "**** 4242",
      other: CARD,
    });
    expect(redact({ card: 4242424242424242 }, policy, { replacement: maskKeepLast(4) })).toEqual({ card: "**** 4242" });
    expect(redact({ card: { number: CARD } }, policy, { replacement: maskKeepLast(4) })).toEqual({ card: "[REDACTED]" });
  });

  test("masks a query parameter inside redactUrl and redactQueryString", () => {
    expect(redactUrl(`https://example.com/pay?card=${CARD}&id=1`, { policy, replacement: maskKeepLast(4) })).toBe(
      "https://example.com/pay?card=**** 4242&id=1",
    );
    expect(redactQueryString(`card=${CARD}`, { policy, replacement: maskKeepLast(4) })).toBe("card=**** 4242");
  });

  test("masks a header value inside redactHeaders, and Headers accepts the result", () => {
    const out = redactHeaders(new Headers([["Authorization", "Bearer abcdef123456"]]), { replacement: maskKeepLast(4) });
    expect(out.get("authorization")).toBe("**** 3456");
    expect(new Headers([["authorization", "**** 3456"]]).get("authorization")).toBe("**** 3456");
    expect(redactHeaders({ Authorization: "Bearer abcdef123456" }, { replacement: maskKeepLast(4) })).toEqual({
      Authorization: "**** 3456",
    });
  });

  test("a mask character outside Latin-1 makes redactHeaders store [REDACTED] in a Headers", () => {
    const out = redactHeaders(new Headers([["Authorization", "Bearer abcdef123456"]]), {
      replacement: maskKeepLast(4, { maskChar: "•" }),
    });
    expect(out.get("authorization")).toBe("[REDACTED]");
  });
});
