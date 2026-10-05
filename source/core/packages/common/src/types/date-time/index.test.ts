import { expect, test } from "vitest";
import * as civil from "./civil";
import * as errors from "./errors";
import * as dateTime from "./index";
import * as instant from "./instant";
import * as localDate from "./local-date";
import * as localDateTime from "./local-date-time";
import * as localTime from "./local-time";
import * as zoneId from "./zone-id";
import * as zonedDateTime from "./zoned-date-time";

test("exports LocalDate", () => {
  expect(dateTime.LocalDate).toBe(localDate.LocalDate);
});

test("exports LocalTime", () => {
  expect(dateTime.LocalTime).toBe(localTime.LocalTime);
});

test("exports LocalDateTime", () => {
  expect(dateTime.LocalDateTime).toBe(localDateTime.LocalDateTime);
});

test("exports ZoneId", () => {
  expect(dateTime.ZoneId).toBe(zoneId.ZoneId);
});

test("exports ZonedDateTime", () => {
  expect(dateTime.ZonedDateTime).toBe(zonedDateTime.ZonedDateTime);
});

test("exports Instant", () => {
  expect(dateTime.Instant).toBe(instant.Instant);
});

test("exports the errors and the guards", () => {
  expect(dateTime.InvalidDateTimeError).toBe(errors.InvalidDateTimeError);
  expect(dateTime.DateTimeParseError).toBe(errors.DateTimeParseError);
  expect(dateTime.isInvalidDateTimeError).toBe(errors.isInvalidDateTimeError);
  expect(dateTime.isDateTimeParseError).toBe(errors.isDateTimeParseError);
  expect(dateTime.UnknownZoneError).toBe(errors.UnknownZoneError);
  expect(dateTime.isUnknownZoneError).toBe(errors.isUnknownZoneError);
  expect(dateTime.ZoneResolutionError).toBe(errors.ZoneResolutionError);
  expect(dateTime.isZoneResolutionError).toBe(errors.isZoneResolutionError);
});

test("exports nothing else, keeping the civil arithmetic and the zone resolver internal", () => {
  expect(Object.keys(dateTime).sort()).toEqual(
    [
      ...Object.keys(errors),
      ...Object.keys(instant),
      ...Object.keys(localDate),
      ...Object.keys(localDateTime),
      ...Object.keys(localTime),
      ...Object.keys(zoneId),
      ...Object.keys(zonedDateTime),
    ].sort(),
  );
  expect(dateTime).not.toHaveProperty(Object.keys(civil)[0] as string);
  expect(dateTime).not.toHaveProperty("resolveLocal");
  expect(dateTime).not.toHaveProperty("disambiguate");
});
