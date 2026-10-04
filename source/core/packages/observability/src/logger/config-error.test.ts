import { VipengeleError } from "@vipengele/ts-core-common";
import { expect, test } from "vitest";
import { isLoggingConfigError, LOGGING_CONFIG_ERROR_CODE, LoggingConfigError } from "./config-error";

class OtherError extends VipengeleError {
  readonly code = "observability.logger.other";
}

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignCopy extends Error {
  readonly code = "observability.logger.config";
}

test("extends Error and VipengeleError", () => {
  const error = new LoggingConfigError("nope");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(VipengeleError);
});

test("preserves the message passed to the constructor", () => {
  expect(new LoggingConfigError("nope").message).toBe("nope");
});

test("carries a namespaced code", () => {
  expect(new LoggingConfigError("nope").code).toBe("observability.logger.config");
  expect(LOGGING_CONFIG_ERROR_CODE).toBe("observability.logger.config");
});

test("the guard accepts an instance", () => {
  expect(isLoggingConfigError(new LoggingConfigError("nope"))).toBe(true);
});

test("the guard accepts an error of the same code from another class identity", () => {
  expect(isLoggingConfigError(new ForeignCopy("nope"))).toBe(true);
});

test("the guard rejects another VipengeleError subclass", () => {
  expect(isLoggingConfigError(new OtherError("nope"))).toBe(false);
});

test.for([new Error("nope"), null, undefined, "observability.logger.config", { code: "observability.logger.config", message: "nope" }])(
  "the guard rejects %o",
  (value) => {
    expect(isLoggingConfigError(value)).toBe(false);
  },
);

test("the guard narrows the value it accepts", () => {
  const thrown: unknown = new LoggingConfigError("nope");

  if (!isLoggingConfigError(thrown)) {
    throw new Error("expected a LoggingConfigError");
  }

  expect(thrown.code).toBe("observability.logger.config");
});
