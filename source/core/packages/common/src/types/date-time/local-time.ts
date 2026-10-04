import { DateTimeParseError, type DateTimeTryParseResult, InvalidDateTimeError } from "./errors";

/** `HH:mm`, `HH:mm:ss` or `HH:mm:ss.S` to `HH:mm:ss.SSS`, exactly: no zone designator, no surrounding space. */
const ISO_TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** Why the fields do not name a time of day, or `undefined` when they do. */
function invalidReason(hour: number, minute: number, second: number, millisecond: number): string | undefined {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return `hour must be an integer from 0 to 23, got ${hour}`;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return `minute must be an integer from 0 to 59, got ${minute}`;
  }
  if (!Number.isInteger(second) || second < 0 || second > 59) {
    return `second must be an integer from 0 to 59, got ${second}`;
  }
  if (!Number.isInteger(millisecond) || millisecond < 0 || millisecond > 999) {
    return `millisecond must be an integer from 0 to 999, got ${millisecond}`;
  }
  return undefined;
}

/** The time of day `str` spells in ISO 8601 form, or `undefined` when it spells none. */
function parseValue(str: string): LocalTime | undefined {
  const match = ISO_TIME.exec(str);
  if (match === null) {
    return undefined;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  // The fraction is a decimal: ".5" is 500 ms and ".05" is 50 ms.
  const millisecond = match[4] === undefined ? 0 : Number(match[4].padEnd(3, "0"));
  return invalidReason(hour, minute, second, millisecond) === undefined ? LocalTime.of(hour, minute, second, millisecond) : undefined;
}

/**
 * A time of day with no date and no time zone, to the millisecond, from 00:00 to 23:59:59.999.
 *
 * Every instance names a real time: {@link LocalTime.of} rejects a field outside its range rather
 * than carrying it into the next unit, so hour 24 and second 60 are errors. Instances are frozen.
 */
export class LocalTime {
  /** The hour of the day, 0-23. */
  readonly hour: number;
  /** The minute of the hour, 0-59. */
  readonly minute: number;
  /** The second of the minute, 0-59. */
  readonly second: number;
  /** The millisecond of the second, 0-999. */
  readonly millisecond: number;

  private constructor(hour: number, minute: number, second: number, millisecond: number) {
    this.hour = hour;
    this.minute = minute;
    this.second = second;
    this.millisecond = millisecond;
    Object.freeze(this);
  }

  /**
   * The time with the given fields.
   *
   * @throws {InvalidDateTimeError} when a field is not an integer in its range: hour 0-23, minute
   *   0-59, second 0-59, millisecond 0-999.
   */
  static of(hour: number, minute: number, second = 0, millisecond = 0): LocalTime {
    const reason = invalidReason(hour, minute, second, millisecond);
    if (reason !== undefined) {
      throw new InvalidDateTimeError(`Invalid time: ${reason}.`);
    }
    return new LocalTime(hour, minute, second, millisecond);
  }

  /**
   * Reads the ISO 8601 time of day `str` spells, in `HH:mm`, `HH:mm:ss` or `HH:mm:ss.SSS` form. The
   * fraction takes one to three digits and is a decimal of a second: `.5` is 500 ms.
   *
   * @throws {DateTimeParseError} when `str` is not in one of those forms, or its fields do not name
   *   a time (`24:00`, `12:60`, `12:00:60`).
   */
  static parse(str: string): LocalTime {
    const value = parseValue(str);
    if (value === undefined) {
      throw new DateTimeParseError(`Cannot parse ${JSON.stringify(str)} as an ISO 8601 time.`);
    }
    return value;
  }

  /**
   * The non-throwing counterpart of {@link LocalTime.parse}: a string that does not spell a time
   * yields `{ success: false }` rather than a {@link DateTimeParseError}.
   */
  static tryParse(str: string): DateTimeTryParseResult<LocalTime> {
    const value = parseValue(str);
    return value === undefined ? { success: false } : { success: true, value };
  }

  /** A negative number when `a` is earlier in the day than `b`, a positive one when later, and `0` when they are equal. */
  static compare(a: LocalTime, b: LocalTime): number {
    return a.hour - b.hour || a.minute - b.minute || a.second - b.second || a.millisecond - b.millisecond;
  }

  /** Whether `other` names the same time of day. */
  equals(other: LocalTime): boolean {
    return LocalTime.compare(this, other) === 0;
  }

  /**
   * The ISO 8601 time of day: `HH:mm`, with `:ss` only when the second or the millisecond is
   * non-zero and `.SSS` only when the millisecond is non-zero. `14:30`, `14:30:05`, `14:30:05.250`.
   */
  toString(): string {
    const hour = String(this.hour).padStart(2, "0");
    const minute = String(this.minute).padStart(2, "0");
    if (this.second === 0 && this.millisecond === 0) {
      return `${hour}:${minute}`;
    }
    const second = String(this.second).padStart(2, "0");
    if (this.millisecond === 0) {
      return `${hour}:${minute}:${second}`;
    }
    return `${hour}:${minute}:${second}.${String(this.millisecond).padStart(3, "0")}`;
  }
}
