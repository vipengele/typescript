import { VipengeleError } from "@vipengele/ts-core-common";
import { expect, test } from "vitest";
import { isReporterConfigError, REPORTER_CONFIG_ERROR_CODE, ReporterConfigError } from "./reporter-config-error";

class OtherError extends VipengeleError {
  readonly code = "observability.errors.other";
}

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignCopy extends Error {
  readonly code = "observability.errors.config";
}

test("extends Error and VipengeleError", () => {
  const error = new ReporterConfigError("nope");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(VipengeleError);
});

test("preserves the message passed to the constructor", () => {
  expect(new ReporterConfigError("nope").message).toBe("nope");
});

test("carries a namespaced code", () => {
  expect(new ReporterConfigError("nope").code).toBe("observability.errors.config");
  expect(REPORTER_CONFIG_ERROR_CODE).toBe("observability.errors.config");
});

test("the guard accepts an instance", () => {
  expect(isReporterConfigError(new ReporterConfigError("nope"))).toBe(true);
});

test("the guard accepts an error of the same code from another class identity", () => {
  expect(isReporterConfigError(new ForeignCopy("nope"))).toBe(true);
});

test("the guard rejects another VipengeleError subclass", () => {
  expect(isReporterConfigError(new OtherError("nope"))).toBe(false);
});

test.for([new Error("nope"), null, undefined, "observability.errors.config", { code: "observability.errors.config", message: "nope" }])(
  "the guard rejects %o",
  (value) => {
    expect(isReporterConfigError(value)).toBe(false);
  },
);

test("the guard narrows the value it accepts", () => {
  const thrown: unknown = new ReporterConfigError("nope");

  if (!isReporterConfigError(thrown)) {
    throw new Error("expected a ReporterConfigError");
  }

  expect(thrown.code).toBe("observability.errors.config");
});
