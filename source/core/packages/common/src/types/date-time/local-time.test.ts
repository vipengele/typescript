import { describe, expect, test } from "vitest";
import { DateTimeParseError, InvalidDateTimeError, isDateTimeParseError, isInvalidDateTimeError } from "./errors";
import { LocalTime } from "./local-time";

describe("LocalTime.of", () => {
  test("holds the fields it is given", () => {
    const value = LocalTime.of(14, 30, 5, 250);

    expect([value.hour, value.minute, value.second, value.millisecond]).toEqual([14, 30, 5, 250]);
  });

  test("defaults the second and the millisecond to zero", () => {
    const value = LocalTime.of(14, 30);

    expect([value.second, value.millisecond]).toEqual([0, 0]);
  });

  test("accepts both ends of the day", () => {
    expect(LocalTime.of(0, 0).toString()).toBe("00:00");
    expect(LocalTime.of(23, 59, 59, 999).toString()).toBe("23:59:59.999");
  });

  test.for([
    [24, 0, 0, 0],
    [-1, 0, 0, 0],
    [0, 60, 0, 0],
    [0, -1, 0, 0],
    [0, 0, 60, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1000],
    [0, 0, 0, -1],
    [1.5, 0, 0, 0],
    [0, 1.5, 0, 0],
    [0, 0, 1.5, 0],
    [0, 0, 0, 1.5],
    [Number.NaN, 0, 0, 0],
    [0, Number.POSITIVE_INFINITY, 0, 0],
  ])("rejects %s:%s:%s.%s with InvalidDateTimeError", ([hour, minute, second, millisecond]) => {
    expect(() => LocalTime.of(hour as number, minute as number, second, millisecond)).toThrow(InvalidDateTimeError);
  });

  test("names the offending field in the message", () => {
    expect(() => LocalTime.of(24, 0)).toThrow("hour must be an integer from 0 to 23, got 24");
    expect(() => LocalTime.of(0, 60)).toThrow("minute must be an integer from 0 to 59, got 60");
    expect(() => LocalTime.of(0, 0, 60)).toThrow("second must be an integer from 0 to 59, got 60");
    expect(() => LocalTime.of(0, 0, 0, 1000)).toThrow("millisecond must be an integer from 0 to 999, got 1000");
  });

  test("throws an error the guard recognises", () => {
    try {
      LocalTime.of(24, 0);
      expect.unreachable("LocalTime.of accepted hour 24");
    } catch (error) {
      expect(isInvalidDateTimeError(error)).toBe(true);
    }
  });

  test("returns a frozen value", () => {
    const value = LocalTime.of(14, 30);

    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      (value as { hour: number }).hour = 1;
    }).toThrow(TypeError);
  });
});

describe("LocalTime.parse", () => {
  test.for(["00:00", "14:30", "23:59", "14:30:05", "00:00:01", "14:30:05.250", "23:59:59.999", "00:00:00.001"])("round-trips %s", (str) => {
    expect(LocalTime.parse(str).toString()).toBe(str);
  });

  test("reads the three forms", () => {
    expect(LocalTime.parse("14:30").equals(LocalTime.of(14, 30))).toBe(true);
    expect(LocalTime.parse("14:30:05").equals(LocalTime.of(14, 30, 5))).toBe(true);
    expect(LocalTime.parse("14:30:05.250").equals(LocalTime.of(14, 30, 5, 250))).toBe(true);
  });

  test("reads the fraction as a decimal of a second", () => {
    expect(LocalTime.parse("12:00:00.5").millisecond).toBe(500);
    expect(LocalTime.parse("12:00:00.05").millisecond).toBe(50);
    expect(LocalTime.parse("12:00:00.005").millisecond).toBe(5);
  });

  test("formats a zero second that has a millisecond", () => {
    expect(LocalTime.parse("12:00:00.5").toString()).toBe("12:00:00.500");
  });

  test("drops an all-zero seconds part", () => {
    expect(LocalTime.parse("12:00:00").toString()).toBe("12:00");
    expect(LocalTime.parse("12:00:00.000").toString()).toBe("12:00");
  });

  test.for([
    "",
    "24:00",
    "12:60",
    "12:00:60",
    "1:30",
    "14:3",
    "14.30",
    "1430",
    "14:30:5",
    "14:30:05.",
    "14:30:05.1234",
    "14:30.5",
    "T14:30",
    "14:30Z",
    " 14:30",
    "14:30 ",
    "-1:30",
    "ab:cd",
  ])("rejects %j with DateTimeParseError", (str) => {
    expect(() => LocalTime.parse(str)).toThrow(DateTimeParseError);
  });

  test("throws an error the guard recognises", () => {
    try {
      LocalTime.parse("24:00");
      expect.unreachable("LocalTime.parse accepted 24:00");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
    }
  });
});

describe("LocalTime.tryParse", () => {
  test("returns the value on success", () => {
    const result = LocalTime.tryParse("14:30:05");

    expect(result.success).toBe(true);
    expect(result.value?.equals(LocalTime.of(14, 30, 5))).toBe(true);
  });

  test.for(["", "24:00", "12:60", "12:00:60", "nope"])("returns success false for %j", (str) => {
    expect(LocalTime.tryParse(str)).toEqual({ success: false });
  });
});

describe("LocalTime.compare and equals", () => {
  test("orders by hour, minute, second then millisecond", () => {
    const ordered = ["00:00", "00:01", "00:01:01", "00:01:01.001", "00:01:01.002", "01:00", "23:59:59.999"].map((str) =>
      LocalTime.parse(str),
    );

    for (const [i, a] of ordered.entries()) {
      for (const [j, b] of ordered.entries()) {
        expect(Math.sign(LocalTime.compare(a, b))).toBe(Math.sign(i - j));
      }
    }
  });

  test("compare is zero exactly when equals is true", () => {
    const a = LocalTime.of(14, 30, 5, 250);

    expect(LocalTime.compare(a, LocalTime.of(14, 30, 5, 250))).toBe(0);
    expect(a.equals(LocalTime.of(14, 30, 5, 250))).toBe(true);
    expect(LocalTime.compare(a, LocalTime.of(14, 30, 5, 251))).not.toBe(0);
    expect(a.equals(LocalTime.of(14, 30, 5, 251))).toBe(false);
  });
});
