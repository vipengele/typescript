import { expect, test } from "vitest";
import { Numeric, normalizeAttributes, redact, VipengeleError } from "./index";
import type { AttributeValue, Attributes, AttributesInput, NormalizeAttributesOptions } from "./index";

test("Numeric resolves from @vipengele/ts-core-common and round-trips a number", () => {
  expect(Numeric.parse(Numeric.format(1234.5, "en-US"), "en-US")).toBe(1234.5);
});

test("redact resolves from @vipengele/ts-core-redaction and redacts a matched key", () => {
  expect(redact({ password: "x" }, { keys: ["password"] })).toEqual({ password: "[REDACTED]" });
});

test("VipengeleError resolves from @vipengele/ts-core-common", () => {
  class TestError extends VipengeleError {
    readonly code = "test_error";
  }

  const error = new TestError("boom");

  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("test_error");
});

test("normalizeAttributes resolves from @vipengele/ts-core-common and produces an AttributeValue-safe record", () => {
  const input: AttributesInput = { at: new Date(0), name: "value" };
  const options: NormalizeAttributesOptions = { maxDepth: 6 };

  const result: Attributes = normalizeAttributes(input, options);
  const at: AttributeValue | undefined = result.at;

  expect(result).toEqual({ at: "1970-01-01T00:00:00.000Z", name: "value" });
  expect(at).toBe("1970-01-01T00:00:00.000Z");
});
