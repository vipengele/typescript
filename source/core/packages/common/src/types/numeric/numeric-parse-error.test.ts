import { expect, test } from "vitest";
import { VipengeleError } from "../../errors/vipengele-error";
import { isNumericParseError, NumericParseError } from "./numeric-parse-error";

class OtherError extends VipengeleError {
  readonly code = "common.numeric.other";
}

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignCopy extends Error {
  readonly code = "common.numeric.parse";
}

test("extends Error and VipengeleError", () => {
  const error = new NumericParseError("nope");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(VipengeleError);
});

test("preserves the message passed to the constructor", () => {
  expect(new NumericParseError("nope").message).toBe("nope");
});

test("carries a namespaced code", () => {
  expect(new NumericParseError("nope").code).toBe("common.numeric.parse");
});

test("the guard accepts an instance", () => {
  expect(isNumericParseError(new NumericParseError("nope"))).toBe(true);
});

test("the guard accepts an error of the same code from another class identity", () => {
  expect(isNumericParseError(new ForeignCopy("nope"))).toBe(true);
});

test("the guard rejects another VipengeleError subclass", () => {
  expect(isNumericParseError(new OtherError("nope"))).toBe(false);
});

test.for([new Error("nope"), null, undefined, "common.numeric.parse", { code: "common.numeric.parse", message: "nope" }])(
  "the guard rejects %o",
  (value) => {
    expect(isNumericParseError(value)).toBe(false);
  },
);

test("the guard narrows the value it accepts", () => {
  const thrown: unknown = new NumericParseError("nope");

  if (!isNumericParseError(thrown)) {
    throw new Error("expected a NumericParseError");
  }

  expect(thrown.code).toBe("common.numeric.parse");
});
