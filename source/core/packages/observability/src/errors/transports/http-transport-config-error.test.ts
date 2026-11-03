import { VipengeleError } from "@vipengele/ts-core-common";
import { expect, test } from "vitest";
import { HTTP_TRANSPORT_CONFIG_ERROR_CODE, HttpTransportConfigError, isHttpTransportConfigError } from "./http-transport-config-error";

class OtherError extends VipengeleError {
  readonly code = "observability.errors.other";
}

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignCopy extends Error {
  readonly code = "observability.errors.http-transport.config";
}

test("extends Error and VipengeleError", () => {
  const error = new HttpTransportConfigError("nope");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(VipengeleError);
});

test("preserves the message passed to the constructor", () => {
  expect(new HttpTransportConfigError("nope").message).toBe("nope");
});

test("carries a namespaced code", () => {
  expect(new HttpTransportConfigError("nope").code).toBe("observability.errors.http-transport.config");
  expect(HTTP_TRANSPORT_CONFIG_ERROR_CODE).toBe("observability.errors.http-transport.config");
});

test("the guard accepts an instance", () => {
  expect(isHttpTransportConfigError(new HttpTransportConfigError("nope"))).toBe(true);
});

test("the guard accepts an error of the same code from another class identity", () => {
  expect(isHttpTransportConfigError(new ForeignCopy("nope"))).toBe(true);
});

test("the guard rejects another VipengeleError subclass", () => {
  expect(isHttpTransportConfigError(new OtherError("nope"))).toBe(false);
});

test.for([
  new Error("nope"),
  null,
  undefined,
  "observability.errors.http-transport.config",
  { code: "observability.errors.http-transport.config", message: "nope" },
])("the guard rejects %o", (value) => {
  expect(isHttpTransportConfigError(value)).toBe(false);
});

test("the guard narrows the value it accepts", () => {
  const thrown: unknown = new HttpTransportConfigError("nope");

  if (!isHttpTransportConfigError(thrown)) {
    throw new Error("expected an HttpTransportConfigError");
  }

  expect(thrown.code).toBe("observability.errors.http-transport.config");
});
