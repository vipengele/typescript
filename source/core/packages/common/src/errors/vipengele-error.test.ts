import { expect, test } from "vitest";
import { VipengeleError } from "./vipengele-error";

class TestError extends VipengeleError {
  readonly code = "test.error";
}

test("extends Error and VipengeleError", () => {
  const error = new TestError("something failed");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(VipengeleError);
});

test("exposes the subclass's code", () => {
  const error = new TestError("something failed");

  expect(error.code).toBe("test.error");
});

test("preserves the message passed to the constructor", () => {
  const error = new TestError("something failed");

  expect(error.message).toBe("something failed");
});
