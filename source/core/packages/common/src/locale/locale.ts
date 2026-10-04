/** Width of a month or weekday name. */
export type NameStyle = "long" | "short" | "narrow";

/** The hour cycle a locale's clock uses: 12-hour (`h11`, `h12`) or 24-hour (`h23`, `h24`). */
export type HourCycle = "h11" | "h12" | "h23" | "h24";

/** 2024-01-01 is a Monday, so seven consecutive days from it run Monday..Sunday. */
const MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A BCP 47 language tag and the calendar and clock conventions it carries. Month and weekday
 * names come back as zero-indexed arrays: months January..December, weekdays Monday..Sunday
 * (ISO order), whatever the locale's own first day of the week.
 */
export class Locale {
  /** The canonicalized BCP 47 tag. */
  readonly tag: string;

  /**
   * @throws {RangeError} when `tag` is not a well-formed BCP 47 language tag, including `""`.
   */
  constructor(tag: string) {
    this.tag = Intl.getCanonicalLocales(tag)[0] as string;
  }

  /** The runtime's own locale, read on every call so a change to it is observed. */
  static default(): Locale {
    return new Locale(new Intl.DateTimeFormat().resolvedOptions().locale);
  }

  /**
   * The hour cycle `Intl.DateTimeFormat` resolves for this locale. `Intl.Locale#hourCycle` is
   * undefined unless the tag spells it out, so the resolved formatter options are read instead.
   */
  get hourCycle(): HourCycle {
    return new Intl.DateTimeFormat(this.tag, { hour: "numeric" }).resolvedOptions().hourCycle as HourCycle;
  }

  /** Whether the locale's clock counts hours 0..23 (or 1..24) rather than in 12-hour halves. */
  get uses24Hour(): boolean {
    const cycle = this.hourCycle;
    return cycle === "h23" || cycle === "h24";
  }

  /** The twelve month names, January first. */
  monthNames(style: NameStyle): string[] {
    const formatter = new Intl.DateTimeFormat(this.tag, { month: style, timeZone: "UTC" });
    return Array.from({ length: 12 }, (_, month) => formatter.format(Date.UTC(2024, month, 1)));
  }

  /** The seven weekday names, Monday first. */
  weekdayNames(style: NameStyle): string[] {
    const formatter = new Intl.DateTimeFormat(this.tag, { weekday: style, timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, day) => formatter.format(MONDAY + day * DAY_MS));
  }
}
