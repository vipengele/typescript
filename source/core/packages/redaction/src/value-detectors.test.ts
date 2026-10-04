// biome-ignore-all lint/security/noSecrets: every fixture is a synthetic token or card number, flagged only for its entropy
import { describe, expect, test } from "vitest";
import { findDetectorSpans } from "./detector";
import type { Detector } from "./key-matcher";
import { awsAccessKey, bearerToken, creditCard, email, githubToken, jwt, stripeKey, valueDetectors } from "./value-detectors";

/** The substrings of `value` one detector matches, through the engine, so `validate` applies. */
function matches(detector: Detector, value: string): string[] {
  return findDetectorSpans([detector], value).map(({ start, end }) => value.slice(start, end));
}

// Credential-shaped fixtures are assembled from fragments so no source literal is itself a credential.
const dotted = (...segments: string[]): string => segments.join(".");
const HEADER = "eyJhbGciOiJIUzI1NiJ9";
const PAYLOAD = "eyJzdWIiOiJleGFtcGxlIn0";
const SIGNATURE = "c2lnbmF0dXJlLWZha2VfZXhhbXBsZQ";
const JWT = dotted(HEADER, PAYLOAD, SIGNATURE);
const AWS_KEY_BODY = ["IOSFODNN7", "EXAMPLE"].join("");
const AWS_KEY = ["AKIA", AWS_KEY_BODY].join("");

describe("jwt", () => {
  test("matches a three-segment token with an eyJ header", () => {
    expect(matches(jwt, `token=${JWT}; path=/`)).toEqual([JWT]);
  });

  test("matches an unsecured token with an empty signature", () => {
    const unsecured = dotted("eyJhbGciOiJub25lIn0", "eyJzdWIiOiJ4In0", "");
    expect(matches(jwt, `${unsecured} rest`)).toEqual([unsecured]);
  });

  test("ignores two-segment strings, headers not starting eyJ, and eyJ inside a longer word", () => {
    expect(matches(jwt, dotted(HEADER, PAYLOAD))).toEqual([]);
    expect(matches(jwt, "abc.def.ghi")).toEqual([]);
    expect(matches(jwt, `x${JWT}`)).toEqual([]);
  });

  test("covers a token with segments of any length to the end of its signature", () => {
    const token = `eyJ${"h".repeat(5000)}.${"p".repeat(20_000)}.${"s".repeat(5000)}`;
    expect(matches(jwt, `token=${token}; path=/`)).toEqual([token]);
  });
});

describe("bearerToken", () => {
  test("the span includes the scheme word, whatever its case", () => {
    expect(matches(bearerToken, "Authorization: Bearer abc.def-123==")).toEqual(["Bearer abc.def-123=="]);
    expect(matches(bearerToken, "authorization: bearer a~b+c/d_e")).toEqual(["bearer a~b+c/d_e"]);
    expect(matches(bearerToken, "BEARER\txyz")).toEqual(["BEARER\txyz"]);
  });

  test("the token stops at a character outside b64token", () => {
    expect(matches(bearerToken, "Bearer abc, next")).toEqual(["Bearer abc"]);
  });

  test("covers a token of any length to the end of its run, padding included", () => {
    const credential = `Bearer ${"a".repeat(10_000)}==`;
    expect(matches(bearerToken, `${credential} next`)).toEqual([credential]);
  });

  test("ignores a scheme with no token, other schemes, and Bearer inside a longer word", () => {
    expect(matches(bearerToken, "Bearer ")).toEqual([]);
    expect(matches(bearerToken, "Basic dXNlcjpwYXNz")).toEqual([]);
    expect(matches(bearerToken, "xBearer abc")).toEqual([]);
  });
});

describe("creditCard", () => {
  test("matches Luhn-valid test numbers of 13 to 19 digits", () => {
    for (const number of ["4222222222222", "378282246310005", "4111111111111111", "6011111111111117", "0004111111111111111"]) {
      expect(matches(creditCard, `card ${number} ok`)).toEqual([number]);
    }
  });

  test("matches Luhn-valid numbers in 4-4-4-N and Amex 4-6-5 groupings with one separator", () => {
    expect(matches(creditCard, "pay 4111 1111 1111 1111 now")).toEqual(["4111 1111 1111 1111"]);
    expect(matches(creditCard, "pay 5500-0000-0000-0004 now")).toEqual(["5500-0000-0000-0004"]);
    expect(matches(creditCard, "pay 4222 2222 2222 2 now")).toEqual(["4222 2222 2222 2"]);
    expect(matches(creditCard, "pay 0004-1111-1111-1111111 now")).toEqual(["0004-1111-1111-1111111"]);
    expect(matches(creditCard, "pay 3782 822463 10005 now")).toEqual(["3782 822463 10005"]);
    expect(matches(creditCard, "pay 3782-822463-10005 now")).toEqual(["3782-822463-10005"]);
    expect(matches(creditCard, "pay 3056 930902 5904 now")).toEqual(["3056 930902 5904"]);
    expect(matches(creditCard, "pay 3056-930902-5904 now")).toEqual(["3056-930902-5904"]);
  });

  test("a CVV or expiry date after the number is left out of the span", () => {
    expect(matches(creditCard, "4111 1111 1111 1111 123")).toEqual(["4111 1111 1111 1111"]);
    expect(matches(creditCard, "4111111111111111 123")).toEqual(["4111111111111111"]);
    expect(matches(creditCard, "4111 1111 1111 1111 12/25")).toEqual(["4111 1111 1111 1111"]);
    expect(matches(creditCard, "4111111111111111 12/25")).toEqual(["4111111111111111"]);
    expect(matches(creditCard, "4111-1111-1111-1111-123")).toEqual(["4111-1111-1111-1111"]);
    expect(matches(creditCard, "3782 822463 10005 1234")).toEqual(["3782 822463 10005"]);
    expect(matches(creditCard, "3056 930902 5904 123")).toEqual(["3056 930902 5904"]);
  });

  test("ignores other groupings and mixed separators", () => {
    expect(matches(creditCard, "4111 11111111 1111")).toEqual([]);
    expect(matches(creditCard, "4111-1111 1111-1111")).toEqual([]);
    expect(matches(creditCard, "3782 822463-10005")).toEqual([]);
    expect(matches(creditCard, "3056 930902-5904")).toEqual([]);
  });

  test("a longer grouped number is read by its leading groups", () => {
    expect(matches(creditCard, "id 4111 1111 1111 1111 1111 1111")).toEqual(["4111 1111 1111 1111"]);
  });

  test("when the leading groups fail Luhn, a card number starting at a later group is matched", () => {
    expect(matches(creditCard, "id 0000 4111 1111 1111 1111")).toEqual(["4111 1111 1111 1111"]);
  });

  test("a 19-digit number is matched contiguously but read by its leading 16 digits when grouped 4-4-4-4-3", () => {
    expect(matches(creditCard, "card 4111111111111112126")).toEqual(["4111111111111112126"]);
    expect(matches(creditCard, "card 4111 1111 1111 1112 126")).toEqual([]);
  });

  test("leaves Luhn-failing digit runs untouched", () => {
    expect(matches(creditCard, "card 4111111111111112")).toEqual([]);
    expect(matches(creditCard, "order 1234567890123456")).toEqual([]);
    expect(matches(creditCard, "order 20240101000012345")).toEqual([]);
    expect(matches(creditCard, "card 4111 1111 1111 1112")).toEqual([]);
    expect(matches(creditCard, "card 3056 930902 5905")).toEqual([]);
  });

  test("leaves digit runs shorter than 13 or longer than 19 untouched, even when Luhn-valid", () => {
    expect(matches(creditCard, "id 000000000000")).toEqual([]);
    expect(matches(creditCard, "id 00004111111111111111")).toEqual([]);
    expect(matches(creditCard, "id 41111111111111111111111111")).toEqual([]);
    expect(matches(creditCard, `id ${"0".repeat(40)}`)).toEqual([]);
  });

  test("a card number starting inside a Luhn-failing candidate is still matched", () => {
    const value = "ref 2024 100001 4111 1111 1111 1111";
    expect(findDetectorSpans([creditCard], value)).toEqual([{ start: 16, end: 35 }]);
    expect(matches(creditCard, "ref 2024 100001 4111-1111-1111-1111")).toEqual(["4111-1111-1111-1111"]);
    expect(matches(creditCard, "ref 2024-100001-4111-1111-1111-1111")).toEqual(["4111-1111-1111-1111"]);
    expect(matches(creditCard, "ref 2024 100001 4111111111111111")).toEqual(["4111111111111111"]);
  });

  test("a double separator ends a grouping", () => {
    expect(matches(creditCard, "4111111111111111  4111111111111111")).toEqual(["4111111111111111", "4111111111111111"]);
    expect(matches(creditCard, "4111 1111--1111 1111")).toEqual([]);
  });

  test("validate checks the Luhn sum of the digits alone", () => {
    const validate = creditCard.validate as (match: string) => boolean;
    expect(validate("4111-1111 1111-1111")).toBe(true);
    expect(validate("4111111111111112")).toBe(false);
    expect(validate("59")).toBe(true);
    expect(validate("")).toBe(true);
  });
});

describe("email", () => {
  test("matches a pragmatic address shape", () => {
    expect(matches(email, "mail jane.doe+tag@mail.example.co.uk, thanks")).toEqual(["jane.doe+tag@mail.example.co.uk"]);
    expect(matches(email, "<a@b.io>")).toEqual(["a@b.io"]);
    expect(matches(email, "x-y@my-host.example")).toEqual(["x-y@my-host.example"]);
  });

  test("ignores an @ without a dotted domain or a top-level label", () => {
    expect(matches(email, "user@localhost")).toEqual([]);
    expect(matches(email, "@example.com")).toEqual([]);
    expect(matches(email, "user@-bad.com")).toEqual([]);
    expect(matches(email, "user@example.c0")).toEqual([]);
  });

  test("an over-long local part is matched only up to its bound", () => {
    const value = `${"a".repeat(100)}@example.com`;
    expect(matches(email, value)).toEqual([`${"a".repeat(64)}@example.com`]);
  });
});

describe("awsAccessKey", () => {
  test("matches each key-type prefix followed by 16 uppercase alphanumerics", () => {
    for (const prefix of ["AKIA", "ASIA", "ABIA", "ACCA"]) {
      const key = `${prefix}${AWS_KEY_BODY}`;
      expect(matches(awsAccessKey, `id=${key}&x`)).toEqual([key]);
    }
  });

  test("ignores a wrong length, lowercase characters and an embedded key", () => {
    expect(matches(awsAccessKey, AWS_KEY.slice(0, -1))).toEqual([]);
    expect(matches(awsAccessKey, `${AWS_KEY}X`)).toEqual([]);
    expect(matches(awsAccessKey, `AKIA${AWS_KEY_BODY.toLowerCase()}`)).toEqual([]);
    expect(matches(awsAccessKey, `X${AWS_KEY}`)).toEqual([]);
  });
});

describe("githubToken", () => {
  test("matches every classic token prefix with at least 36 alphanumerics", () => {
    for (const prefix of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]) {
      const token = `${prefix}${"x".repeat(36)}`;
      expect(matches(githubToken, `token ${token}.`)).toEqual([token]);
    }
  });

  test("matches a fine-grained personal access token", () => {
    const token = `github_pat_${"A".repeat(22)}_${"b".repeat(59)}`;
    expect(matches(githubToken, `token: ${token}`)).toEqual([token]);
  });

  test("ignores short tokens, unknown prefixes and tokens longer than the bound", () => {
    expect(matches(githubToken, `ghp_${"x".repeat(35)}`)).toEqual([]);
    expect(matches(githubToken, `ghx_${"x".repeat(36)}`)).toEqual([]);
    expect(matches(githubToken, `ghp_${"x".repeat(300)}`)).toEqual([]);
  });
});

describe("stripeKey", () => {
  test("matches secret and restricted keys in live and test mode", () => {
    for (const prefix of ["sk_live_", "sk_test_", "rk_live_", "rk_test_"]) {
      const key = `${prefix}${"0".repeat(24)}`;
      expect(matches(stripeKey, `key ${key} end`)).toEqual([key]);
    }
  });

  test("ignores publishable keys, unknown modes and short keys", () => {
    expect(matches(stripeKey, `pk_live_${"0".repeat(24)}`)).toEqual([]);
    expect(matches(stripeKey, `sk_prod_${"0".repeat(24)}`)).toEqual([]);
    expect(matches(stripeKey, `sk_test_${"0".repeat(23)}`)).toEqual([]);
  });
});

describe("valueDetectors", () => {
  test("bundles the seven built-in detectors in a fixed order", () => {
    expect(valueDetectors).toEqual([jwt, bearerToken, creditCard, email, awsAccessKey, githubToken, stripeKey]);
    expect(valueDetectors).toHaveLength(7);
  });

  test("the bundle and every detector in it are frozen", () => {
    expect(Object.isFrozen(valueDetectors)).toBe(true);
    for (const detector of valueDetectors) {
      expect(Object.isFrozen(detector)).toBe(true);
    }
  });

  test("no pattern carries the g or y flag", () => {
    for (const { pattern } of valueDetectors) {
      expect(pattern.flags).not.toMatch(/[gy]/);
    }
  });

  test("finds every shape in one mixed value", () => {
    const value = `Bearer t0k / 4111 1111 1111 1111 / a@b.io / ${AWS_KEY} / ${JWT}`;
    expect(findDetectorSpans(valueDetectors, value).map(({ start, end }) => value.slice(start, end))).toEqual([
      "Bearer t0k",
      "4111 1111 1111 1111",
      "a@b.io",
      AWS_KEY,
      JWT,
    ]);
  });
});

// Each fixture is large enough that a pattern costing more than linear time in the value's length
// would run for an impractically long time; the assertions are on the spans found, never on elapsed
// time.
describe("pathological inputs complete with the expected spans", () => {
  const size = 50_000;

  test.each([
    ["a long local-part run before an @", `${"a".repeat(size)}@`, 0],
    ["a long run of dotted labels with no top-level label", `a@${"a.".repeat(size)}`, 0],
    ["a long run of dotted labels, matched up to the label bound", `a@${"ab.".repeat(size)}`, 1],
    ["repeated local parts and @ signs", "a@".repeat(size), 0],
    ["long labels of digits with no top-level label", `a@${`${"1".repeat(63)}.`.repeat(size / 64)}`, 0],
    ["a long run of hyphenated label characters", `a@${"a-".repeat(size)}`, 0],
    ["eyJ followed by dots", `eyJ${".".repeat(size)}`, 0],
    ["a long base64url run with no dots", `eyJ${"a".repeat(size)}`, 0],
    ["a header then a long payload run with no second dot", `eyJa.${"b".repeat(size)}`, 0],
    ["a header then a long payload run then a dot", `eyJa.${"b".repeat(size)}.`, 1],
    ["repeated eyJ headers", "eyJ".repeat(size), 0],
    ["repeated eyJ headers each followed by a dot", "eyJ.".repeat(size / 4), 0],
    ["repeated one-character segments, three to a token", "eyJa.".repeat(9999), 3333],
    ["repeated two-segment strings separated by spaces", "eyJa.b ".repeat(size / 7), 0],
    ["a long digit run", "4".repeat(size), 0],
    ["alternating digits and spaces", "4 ".repeat(size), 0],
    ["alternating digits and hyphens", "4-".repeat(size), 0],
    ["repeated Luhn-failing four-digit groups", "4111 ".repeat(size / 5), 0],
    ["repeated Luhn-failing Diners-shaped references", "2024 100001 ".repeat(5000), 0],
    ["repeated Luhn-failing Diners-shaped references, then a card", `${"2024 100001 ".repeat(5000)}4111 1111 1111 1111`, 1],
    ["Bearer followed by spaces", `Bearer${" ".repeat(size)}`, 0],
    ["a long b64token run", `Bearer ${"a".repeat(size)}`, 1],
    ["a short token then alternating characters and spaces", `Bearer ${"a ".repeat(size / 2)}`, 1],
    ["a long run of padding", `Bearer a${"=".repeat(size)}`, 1],
    ["repeated Bearer schemes, each taking the next as its token", "Bearer ".repeat(7000), 3500],
    ["a long uppercase run", `AKIA${"A".repeat(size)}`, 0],
    ["a long ghp_ run", `ghp_${"a".repeat(size)}`, 0],
    ["a long github_pat_ run", `github_pat_${"_".repeat(size)}`, 0],
    ["a long sk_live_ run", `sk_live_${"a".repeat(size)}`, 0],
  ])("%s", (_name, value, expected) => {
    expect(findDetectorSpans(valueDetectors, value)).toHaveLength(expected);
  });
});
