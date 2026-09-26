import { expect, test } from "vitest";
import { Numeric, redact } from "./index";

test("Numeric resolves from @vipengele/ts-core-common and round-trips a number", () => {
  expect(Numeric.parse(Numeric.format(1234.5, "en-US"), "en-US")).toBe(1234.5);
});

test("redact resolves from @vipengele/ts-core-redaction and redacts a matched key", () => {
  expect(redact({ password: "x" }, { keys: ["password"] })).toEqual({ password: "[REDACTED]" });
});
