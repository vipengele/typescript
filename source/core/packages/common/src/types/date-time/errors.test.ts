import { describe, expect, test } from "vitest";
import { VipengeleError } from "../../errors/vipengele-error";
import {
  DateTimeParseError,
  InvalidDateTimeError,
  isDateTimeParseError,
  isInvalidDateTimeError,
  isUnknownZoneError,
  isZoneResolutionError,
  UnknownZoneError,
  ZoneResolutionError,
} from "./errors";

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignInvalid extends Error {
  readonly code = "common.date-time.invalid";
}

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignParse extends Error {
  readonly code = "common.date-time.parse";
}

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignUnknownZone extends Error {
  readonly code = "common.date-time.unknown-zone";
}

/** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
class ForeignZoneResolution extends Error {
  readonly code = "common.date-time.zone-resolution";
}

describe.for([
  {
    name: "InvalidDateTimeError",
    Error: InvalidDateTimeError,
    code: "common.date-time.invalid",
    guard: isInvalidDateTimeError,
    Foreign: ForeignInvalid,
    other: new DateTimeParseError("nope"),
  },
  {
    name: "DateTimeParseError",
    Error: DateTimeParseError,
    code: "common.date-time.parse",
    guard: isDateTimeParseError,
    Foreign: ForeignParse,
    other: new InvalidDateTimeError("nope"),
  },
  {
    name: "UnknownZoneError",
    Error: UnknownZoneError,
    code: "common.date-time.unknown-zone",
    guard: isUnknownZoneError,
    Foreign: ForeignUnknownZone,
    other: new DateTimeParseError("nope"),
  },
  {
    name: "ZoneResolutionError",
    Error: ZoneResolutionError,
    code: "common.date-time.zone-resolution",
    guard: isZoneResolutionError,
    Foreign: ForeignZoneResolution,
    other: new UnknownZoneError("nope"),
  },
])("$name", ({ Error: ErrorClass, code, guard, Foreign, other }) => {
  test("extends Error and VipengeleError", () => {
    const error = new ErrorClass("nope");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VipengeleError);
  });

  test("preserves the message passed to the constructor", () => {
    expect(new ErrorClass("nope").message).toBe("nope");
  });

  test("carries a namespaced code", () => {
    expect(new ErrorClass("nope").code).toBe(code);
  });

  test("the guard accepts an instance", () => {
    expect(guard(new ErrorClass("nope"))).toBe(true);
  });

  test("the guard accepts an error of the same code from another class identity", () => {
    expect(guard(new Foreign("nope"))).toBe(true);
  });

  test("the guard rejects the other date-time error", () => {
    expect(guard(other)).toBe(false);
  });

  test.for([new Error("nope"), null, undefined, code, { code, message: "nope" }])("the guard rejects %o", (value) => {
    expect(guard(value)).toBe(false);
  });
});
