// biome-ignore-all lint/security/noSecrets: the redaction fixtures are URL and header strings, flagged only for their entropy
import { expect, test } from "vitest";
import {
  composePolicies,
  Locale,
  Numeric,
  normalizeAttributes,
  redact,
  redactHeaders,
  redactQueryString,
  redactUrl,
  Scope,
  secretKeys,
  VipengeleError,
} from "./index";
import type {
  AttributeValue,
  Attributes,
  AttributesInput,
  HourCycle,
  IsoWeekday,
  NameStyle,
  NormalizeAttributesOptions,
  RedactStringOptions,
} from "./index";

test("Numeric resolves from @vipengele/ts-core-common and round-trips a number", () => {
  const locale = new Locale("en-US");

  expect(Numeric.parse(Numeric.format(1234.5, locale), locale)).toBe(1234.5);
});

test("Locale resolves from @vipengele/ts-core-common/locale and exposes its calendar conventions", () => {
  const locale = new Locale("en-us");
  const style: NameStyle = "long";
  const firstDay: IsoWeekday = locale.firstDayOfWeek;
  const cycle: HourCycle = locale.hourCycle;

  expect(locale.tag).toBe("en-US");
  expect(firstDay).toBe(7);
  expect(["h11", "h12"]).toContain(cycle);
  expect(locale.monthNames(style)[0]).toBe("January");
});

test("redact resolves from @vipengele/ts-core-redaction and redacts a matched key", () => {
  expect(redact({ password: "x" }, { keys: ["password"] })).toEqual({ password: "[REDACTED]" });
});

test("secretKeys resolves from @vipengele/ts-core-redaction and redacts a secret key", () => {
  expect(redact({ password: "x", name: "n" }, secretKeys)).toEqual({ password: "[REDACTED]", name: "n" });
});

test("redactUrl resolves from @vipengele/ts-core-redaction and redacts a matched query parameter", () => {
  const options: RedactStringOptions = { policy: secretKeys };

  expect(redactUrl("https://u:p@h/?token=x", options)).toBe("https://[REDACTED]:[REDACTED]@h/?token=[REDACTED]");
});

test("redactQueryString resolves from @vipengele/ts-core-redaction and redacts a matched query parameter", () => {
  expect(redactQueryString("?token=x&a=1")).toBe("?token=[REDACTED]&a=1");
});

test("redactHeaders resolves from @vipengele/ts-core-redaction and redacts a matched header", () => {
  expect(redactHeaders({ Authorization: "Bearer x", Accept: "a" })).toEqual({ Authorization: "[REDACTED]", Accept: "a" });
});

test("composePolicies resolves from @vipengele/ts-core-redaction and composes policies end to end", () => {
  const policy = composePolicies(secretKeys, { keys: [{ segments: "ssn" }], except: ["tokenCount"] });

  expect(redact({ password: "x", ssn: "1", tokenCount: 3 }, policy)).toEqual({
    password: "[REDACTED]",
    ssn: "[REDACTED]",
    tokenCount: 3,
  });
});

test("VipengeleError resolves from @vipengele/ts-core-common", () => {
  class TestError extends VipengeleError {
    readonly code = "test_error";
  }

  const error = new TestError("boom");

  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("test_error");
});

test("Scope resolves from @vipengele/ts-core-common/scope and isolates a tagged unit of work", () => {
  expect(Scope.isolated("t", {}, () => Scope.current().tag)).toBe("t");
});

test("normalizeAttributes resolves from @vipengele/ts-core-common and produces an AttributeValue-safe record", () => {
  const input: AttributesInput = { at: new Date(0), name: "value" };
  const options: NormalizeAttributesOptions = { maxDepth: 6 };

  const result: Attributes = normalizeAttributes(input, options);
  const at: AttributeValue | undefined = result.at;

  expect(result).toEqual({ at: "1970-01-01T00:00:00.000Z", name: "value" });
  expect(at).toBe("1970-01-01T00:00:00.000Z");
});
