import type { Locale } from "../../locale";
import type { CivilDate } from "./civil";

/** A calendar field a locale's numeric date pattern places. */
export type DateField = "year" | "month" | "day";

/**
 * The order a locale writes a numeric date's fields in, and the text around them.
 *
 * `literals` has one more entry than `fields`: `literals[i]` precedes `fields[i]`, and the last
 * entry follows the last field. An entry is `""` where the locale writes nothing. Literals are
 * kept exactly as `Intl` emits them, bidi marks included, so formatted output displays in the
 * locale's own direction.
 */
export interface DatePattern {
  readonly fields: readonly DateField[];
  readonly literals: readonly string[];
}

/** A locale's pattern and the expression that reads a string written in it. */
interface ResolvedDatePattern {
  readonly pattern: DatePattern;
  readonly matcher: RegExp;
}

/**
 * Directional marks `Intl` inserts around separators in right-to-left locales — `ar-EG` writes
 * U+200F before each `/` — and that a person copying or retyping a date may add or drop. They
 * carry no meaning in a numeric date, so parsing removes them wherever they sit. The set is by
 * character, not by locale, because which locales emit a mark moves between ICU versions.
 */
const BIDI_MARKS = /[‎‏؜]/g;

/** Characters with a meaning of their own inside a regular expression. */
const REGEXP_SYNTAX = /[\\^$.*+?()[\]{}|/-]/g;

/**
 * 2026-02-03: month and day differ and are each below 10, so their positions are told apart and
 * a 2-digit request is visibly padded.
 */
const REFERENCE_DATE = Date.UTC(2026, 1, 3);

/**
 * The year is exactly four digits, as `format` pads it: a two-digit year would be read as a
 * year in the first century rather than a recent one, so it is rejected rather than guessed at.
 * Month and day take one or two digits, so a date typed without padding (`2/3/2026`) reads the
 * same as the padded form `format` writes.
 */
const FIELD_SOURCE: Readonly<Record<DateField, string>> = {
  year: "(\\d{4})",
  month: "(\\d{1,2})",
  day: "(\\d{1,2})",
};

/**
 * Keyed by `Locale#tag`. A locale's pattern is fixed for the process's lifetime — only the ICU
 * version changes it — and a second copy of this module recomputing the same pattern is
 * harmless, so a module-level cache is enough.
 */
const CACHE = new Map<string, ResolvedDatePattern>();

/** `str` with every bidi mark removed. */
export function stripBidiMarks(str: string): string {
  return str.replace(BIDI_MARKS, "");
}

function escapeRegExp(str: string): string {
  return str.replace(REGEXP_SYNTAX, "\\$&");
}

function resolve(locale: Locale): ResolvedDatePattern {
  const cached = CACHE.get(locale.tag);
  if (cached !== undefined) {
    return cached;
  }

  const parts = new Intl.DateTimeFormat(locale.tag, {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(REFERENCE_DATE);

  const fields: DateField[] = [];
  const literals = [""];
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      fields.push(part.type);
      literals.push("");
    } else {
      literals[literals.length - 1] += part.value;
    }
  }

  const source = literals
    .map((literal, index) => {
      const field = fields[index];
      const text = escapeRegExp(stripBidiMarks(literal));
      return field === undefined ? text : text + FIELD_SOURCE[field];
    })
    .join("");

  const resolved = { pattern: { fields, literals }, matcher: new RegExp(`^\\s*${source}\\s*$`) };
  CACHE.set(locale.tag, resolved);
  return resolved;
}

/**
 * The order and separators `locale` writes a numeric date with, read from the runtime's own CLDR
 * data through `Intl.DateTimeFormat#formatToParts` rather than tabulated: which separator and
 * order a locale uses moves between ICU versions.
 *
 * The Gregorian calendar and `latn` digits are forced, so `th-TH` counts years from the common
 * era rather than the Buddhist one and `ar-EG` writes ASCII digits.
 */
export function resolveDatePattern(locale: Locale): DatePattern {
  return resolve(locale).pattern;
}

/**
 * The date written in `locale`'s numeric pattern: the year padded to four digits, month and day
 * to two, between the locale's own separators.
 */
export function formatDate(date: CivilDate, locale: Locale): string {
  const { fields, literals } = resolve(locale).pattern;
  let text = literals[0] as string;
  fields.forEach((field, index) => {
    text += String(date[field]).padStart(field === "year" ? 4 : 2, "0") + literals[index + 1];
  });
  return text;
}

/**
 * The year, month and day `str` writes in `locale`'s numeric pattern, or `undefined` when it does
 * not follow the pattern. The fields are not checked against the calendar: `02/30/2026` in
 * `en-US` yields month 2, day 30.
 *
 * Bidi marks are removed first and whitespace around the date is ignored; the separators must
 * otherwise be the locale's own.
 */
export function parseDate(str: string, locale: Locale): CivilDate | undefined {
  const { pattern, matcher } = resolve(locale);
  const match = matcher.exec(stripBidiMarks(str));
  if (match === null) {
    return undefined;
  }

  const values: Record<DateField, number> = { year: 0, month: 0, day: 0 };
  pattern.fields.forEach((field, index) => {
    values[field] = Number(match[index + 1]);
  });
  return values;
}
