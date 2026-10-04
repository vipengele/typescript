import { expect, test } from "vitest";
import * as civil from "./civil";
import * as errors from "./errors";
import * as dateTime from "./index";
import * as localDate from "./local-date";

test("exports LocalDate", () => {
  expect(dateTime.LocalDate).toBe(localDate.LocalDate);
});

test("exports both errors and both guards", () => {
  expect(dateTime.InvalidDateTimeError).toBe(errors.InvalidDateTimeError);
  expect(dateTime.DateTimeParseError).toBe(errors.DateTimeParseError);
  expect(dateTime.isInvalidDateTimeError).toBe(errors.isInvalidDateTimeError);
  expect(dateTime.isDateTimeParseError).toBe(errors.isDateTimeParseError);
});

test("exports nothing else, keeping the civil arithmetic internal", () => {
  expect(Object.keys(dateTime).sort()).toEqual([...Object.keys(errors), ...Object.keys(localDate)].sort());
  expect(dateTime).not.toHaveProperty(Object.keys(civil)[0] as string);
});
