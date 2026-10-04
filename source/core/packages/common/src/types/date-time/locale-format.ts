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

/** A field a {@link DigitsToken} reads: one of a date's fields, the hour or the minute. */
export type DigitField = DateField | "hour" | "minute";

/** Exactly `text`; with `foldCase`, in any letter case, `text` then being lower-case. */
export interface TextToken {
  readonly kind: "text";
  readonly text: string;
  readonly foldCase: boolean;
}

/** A run of `min` or more whitespace characters of any kind. */
export interface SpaceToken {
  readonly kind: "space";
  readonly min: number;
}

/** A run of `min` to `max` ASCII digits, the value of `field`. */
export interface DigitsToken {
  readonly kind: "digits";
  readonly field: DigitField;
  readonly min: number;
  readonly max: number;
}

/** One of two day-period markers, each spelled as a sequence of text and space tokens. */
export interface DayPeriodToken {
  readonly kind: "dayPeriod";
  readonly am: readonly Token[];
  readonly pm: readonly Token[];
}

/** No text at all: records the position it sits at, so a caller can cut the input there. */
export interface MarkToken {
  readonly kind: "mark";
}

/** One step of the sequence {@link matchTokens} reads a string with. */
export type Token = TextToken | SpaceToken | DigitsToken | DayPeriodToken | MarkToken;

/**
 * Where a token matched: `start` and `end` are offsets into the string read. `pm` is `true` only
 * for a {@link DayPeriodToken} that matched its `pm` marker.
 */
export interface TokenMatch {
  readonly start: number;
  readonly end: number;
  readonly pm: boolean;
}

/** A locale's pattern and the tokens that read a string written in it. */
interface ResolvedDatePattern {
  readonly pattern: DatePattern;
  /** The tokens for one date, which a date-time's tokens embed. */
  readonly tokens: readonly Token[];
  /** {@link tokens} with whitespace allowed around them. */
  readonly matcher: readonly Token[];
}

/**
 * Directional marks `Intl` inserts around separators in right-to-left locales — `ar-EG` writes
 * U+200F before each `/` — and that a person copying or retyping a date may add or drop. They
 * carry no meaning in a numeric date, so parsing removes them wherever they sit. The set is by
 * character, not by locale, because which locales emit a mark moves between ICU versions.
 */
const BIDI_MARKS = /[‎‏؜]/g;

/** One whitespace character of any kind: a space, U+00A0, U+202F or another space separator. */
const WHITESPACE_CHARACTER = /\s/;

/** One ASCII digit. */
const DIGIT = /\d/;

/** Any whitespace, or none: what is allowed around a whole date, time or date-time. */
const OPTIONAL_SPACE: SpaceToken = { kind: "space", min: 0 };

/**
 * 2026-02-03: month and day differ and are each below 10, so their positions are told apart and
 * a 2-digit request is visibly padded.
 */
const REFERENCE_DATE = Date.UTC(2026, 1, 3);

/** A numeric date in the Gregorian calendar and ASCII digits, whatever the locale's defaults. */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  calendar: "gregory",
  numberingSystem: "latn",
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

/**
 * The year is exactly four digits, as `format` pads it: a two-digit year would be read as a
 * year in the first century rather than a recent one, so it is rejected rather than guessed at.
 * Month and day take one or two digits, so a date typed without padding (`2/3/2026`) reads the
 * same as the padded form `format` writes.
 */
const FIELD_TOKEN: Readonly<Record<DateField, DigitsToken>> = {
  year: { kind: "digits", field: "year", min: 4, max: 4 },
  month: { kind: "digits", field: "month", min: 1, max: 2 },
  day: { kind: "digits", field: "day", min: 1, max: 2 },
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

/**
 * The minimum length the tokens after `index` require of the run `tokens[index]` starts: the
 * `min` of each following token of the same kind, up to the first token of another kind. A mark
 * matches no text, so it neither counts nor ends the run.
 */
function reserved(tokens: readonly Token[], index: number): number {
  const { kind } = tokens[index] as SpaceToken | DigitsToken;
  let total = 0;
  for (const token of tokens.slice(index + 1)) {
    if (token.kind === "mark") {
      continue;
    }
    if (token.kind !== kind) {
      break;
    }
    total += (token as SpaceToken | DigitsToken).min;
  }
  return total;
}

/**
 * The run `tokens[index]` matches at `start`: as many characters `member` accepts as are there, up
 * to `max`, less what the same-kind tokens straight after it require ({@link reserved}), and
 * nothing when that leaves fewer than `min`.
 */
function matchRun(
  tokens: readonly Token[],
  index: number,
  str: string,
  start: number,
  member: RegExp,
  min: number,
  max: number,
): TokenMatch | undefined {
  let available = 0;
  while (member.test(str.charAt(start + available))) {
    available++;
  }
  const length = Math.min(max, available - reserved(tokens, index));
  return length < min ? undefined : { start, end: start + length, pm: false };
}

function matchToken(tokens: readonly Token[], index: number, str: string, start: number): TokenMatch | undefined {
  const token = tokens[index] as Token;
  switch (token.kind) {
    case "text": {
      const end = start + token.text.length;
      const text = str.slice(start, end);
      return (token.foldCase ? text.toLowerCase() : text) === token.text ? { start, end, pm: false } : undefined;
    }
    case "space":
      return matchRun(tokens, index, str, start, WHITESPACE_CHARACTER, token.min, Number.POSITIVE_INFINITY);
    case "digits":
      return matchRun(tokens, index, str, start, DIGIT, token.min, token.max);
    case "dayPeriod": {
      const am = matchFrom(token.am, str, start);
      const pm = matchFrom(token.pm, str, start);
      if (pm !== undefined && (am === undefined || pm.end > am.end)) {
        return { start, end: pm.end, pm: true };
      }
      return am === undefined ? undefined : { start, end: am.end, pm: false };
    }
    case "mark":
      return { start, end: start, pm: false };
  }
}

/** Each token's match, in turn from `from`, and where the last one ends; `undefined` when one fails. */
function matchFrom(tokens: readonly Token[], str: string, from: number): { matches: TokenMatch[]; end: number } | undefined {
  const matches: TokenMatch[] = [];
  let end = from;
  for (const index of tokens.keys()) {
    const match = matchToken(tokens, index, str, end);
    if (match === undefined) {
      return undefined;
    }
    matches.push(match);
    end = match.end;
  }
  return { matches, end };
}

/**
 * Where each of `tokens` matches when together they read the whole of `str`, or `undefined` when
 * they do not.
 *
 * Tokens are read left to right and none is ever revisited, so reading takes time linear in the
 * string's length. A run token (space or digits) takes as long a run as is there, up to its
 * `max`, but leaves the `min` of every same-kind token straight after it: `\d{1,2}` before
 * `\d{4}` reads `12026` as `1` and `2026`. It never leaves characters for a token of another kind,
 * so a space token followed by a text token starting with whitespace never matches. A day period
 * takes whichever of its markers matches the longer text, `am` when both match the same length.
 */
export function matchTokens(tokens: readonly Token[], str: string): TokenMatch[] | undefined {
  const matched = matchFrom(tokens, str, 0);
  return matched === undefined || matched.end !== str.length ? undefined : matched.matches;
}

/** `tokens` with any whitespace, or none, allowed before and after them. */
function anchored(tokens: readonly Token[]): Token[] {
  return [OPTIONAL_SPACE, ...tokens, OPTIONAL_SPACE];
}

/** `literal` matched exactly, bidi marks dropped; nothing for a literal that is only bidi marks. */
function exactTokens(literal: string): Token[] {
  const text = stripBidiMarks(literal);
  return text === "" ? [] : [{ kind: "text", text, foldCase: false }];
}

/** The number each digits token read, by the field it reads. */
function readDigits(tokens: readonly Token[], matches: readonly TokenMatch[], str: string): Partial<Record<DigitField, number>> {
  const values: Partial<Record<DigitField, number>> = {};
  tokens.forEach((token, index) => {
    if (token.kind === "digits") {
      const { start, end } = matches[index] as TokenMatch;
      values[token.field] = Number(str.slice(start, end));
    }
  });
  return values;
}

function resolve(locale: Locale): ResolvedDatePattern {
  const cached = CACHE.get(locale.tag);
  if (cached !== undefined) {
    return cached;
  }

  const parts = new Intl.DateTimeFormat(locale.tag, DATE_OPTIONS).formatToParts(REFERENCE_DATE);

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

  const tokens = literals.flatMap((literal, index): Token[] => {
    const field = fields[index];
    const text = exactTokens(literal);
    return field === undefined ? text : [...text, FIELD_TOKEN[field]];
  });

  const resolved = { pattern: { fields, literals }, tokens, matcher: anchored(tokens) };
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

/** What a {@link DateSegment} holds: one of the date's fields, or the text between them. */
export type DateSegmentType = DateField | "literal";

/** One run of a formatted date: a field's padded digits, or a literal exactly as the locale writes it. */
export interface DateSegment {
  readonly type: DateSegmentType;
  readonly value: string;
}

/**
 * The date written in `locale`'s numeric pattern, split into its fields and the literals between
 * them, in the order the locale writes them. The year is padded to four digits, month and day to
 * two. A literal is kept exactly as `Intl` emits it, bidi marks included, and one the locale
 * leaves empty is omitted, so no segment has an empty `value` and the values joined are
 * {@link formatDate}'s output.
 */
export function dateSegments(date: CivilDate, locale: Locale): DateSegment[] {
  const { fields, literals } = resolve(locale).pattern;
  const segments: DateSegment[] = [];
  literals.forEach((literal, index) => {
    if (literal !== "") {
      segments.push({ type: "literal", value: literal });
    }
    const field = fields[index];
    if (field !== undefined) {
      segments.push({ type: field, value: String(date[field]).padStart(field === "year" ? 4 : 2, "0") });
    }
  });
  return segments;
}

/**
 * The date written in `locale`'s numeric pattern: the year padded to four digits, month and day
 * to two, between the locale's own separators.
 */
export function formatDate(date: CivilDate, locale: Locale): string {
  return dateSegments(date, locale)
    .map((segment) => segment.value)
    .join("");
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
  const { matcher } = resolve(locale);
  const input = stripBidiMarks(str);
  const matches = matchTokens(matcher, input);
  if (matches === undefined) {
    return undefined;
  }

  const { year, month, day } = readDigits(matcher, matches, input) as Record<DateField, number>;
  return { year, month, day };
}

/** A field a locale's time pattern places: the hour, the minute, or the day period (AM or PM). */
export type TimeField = "hour" | "minute" | "dayPeriod";

/** An hour (0-23) and a minute (0-59): the precision a locale's short time pattern writes. */
export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

/**
 * The order a locale writes an hour-and-minute time's fields in, the text around them, and the
 * day-period markers a 12-hour clock writes.
 *
 * `literals` relates to `fields` as in {@link DatePattern}, bidi marks and the locale's own space
 * characters (U+202F before `PM` in newer ICU versions) included. `am` and `pm` are the markers
 * for the first and second half of the day, both `""` on a 24-hour clock, where `fields` holds no
 * `dayPeriod`.
 */
export interface TimePattern {
  readonly twelveHour: boolean;
  readonly fields: readonly TimeField[];
  readonly literals: readonly string[];
  readonly am: string;
  readonly pm: string;
}

/** A locale's time pattern and the tokens that read a string written in it. */
interface ResolvedTimePattern {
  readonly pattern: TimePattern;
  /** The tokens for one time, which a date-time's tokens embed. */
  readonly tokens: readonly Token[];
  /** {@link tokens} with whitespace allowed around them. */
  readonly matcher: readonly Token[];
}

/**
 * Where a locale puts the time relative to the date when it writes both, and the text around
 * them: `literals[0]` precedes the first of the two, `literals[1]` sits between them and
 * `literals[2]` follows the second. `en-US` writes the date first with `, ` between; `vi` writes
 * the time first; `eu` wraps the time in parentheses.
 */
export interface DateTimeLayout {
  readonly timeFirst: boolean;
  readonly literals: readonly [string, string, string];
}

/**
 * A locale's date-time layout and the tokens that read a string written in it. `date` and `time`
 * are the indexes of the marks before and after each half within `matcher`.
 */
interface ResolvedDateTimeLayout {
  readonly layout: DateTimeLayout;
  readonly matcher: readonly Token[];
  readonly date: readonly [number, number];
  readonly time: readonly [number, number];
}

/** The two halves of a string written in a locale's date-time layout. */
export interface DateTimeText {
  readonly date: string;
  readonly time: string;
}

/**
 * 01:05 and 13:05 on {@link REFERENCE_DATE}: hour and minute differ, so their positions are told
 * apart, and the two fall in different halves of the day, so each yields its own day period.
 */
const MORNING = REFERENCE_DATE + (1 * 60 + 5) * 60_000;
const AFTERNOON = MORNING + 12 * 60 * 60_000;

/**
 * The layout used when the locale's combined date-time output does not hold its date-only and
 * time-only outputs as two separate runs: the date, a space, the time.
 */
const FALLBACK_LAYOUT: DateTimeLayout = { timeFirst: false, literals: ["", " ", ""] };

/** A run of whitespace of any kind: a space, U+00A0, U+202F or another space separator. */
const WHITESPACE = /\s+/g;

/** Keyed by `Locale#tag` and the hour cycle, for the reason {@link CACHE} is keyed by tag. */
const TIME_CACHE = new Map<string, ResolvedTimePattern>();
const DATE_TIME_CACHE = new Map<string, ResolvedDateTimeLayout>();

/**
 * `literal` as tokens in which bidi marks are dropped, letter case is ignored and each run of
 * whitespace matches any run of whitespace: ICU versions disagree on whether a time's separators
 * are regular spaces, U+00A0 or U+202F, and a person typing one writes a regular space.
 */
function spacedTokens(literal: string): Token[] {
  return stripBidiMarks(literal)
    .split(WHITESPACE)
    .flatMap((text, index): Token[] => [
      ...(index === 0 ? [] : [{ kind: "space", min: 1 } as const]),
      ...(text === "" ? [] : [{ kind: "text", text: text.toLowerCase(), foldCase: true } as const]),
    ]);
}

/**
 * The cycle a locale's time is written on: `h12` (hours 01-12) for a locale whose cycle is `h11`
 * or `h12`, `h23` (hours 00-23) for one whose cycle is `h23` or `h24`. Written on their own cycles,
 * `h11` would spell midnight `00:00 AM` and `h24` would spell it `24:00`, neither of which a
 * reader of the usual 12- or 24-hour clock accepts.
 */
function clockCycle(locale: Locale): "h12" | "h23" {
  return locale.uses24Hour ? "h23" : "h12";
}

function cacheKey(locale: Locale): string {
  return `${locale.tag} ${clockCycle(locale)}`;
}

function timeFormatOptions(locale: Locale): Intl.DateTimeFormatOptions {
  return {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: clockCycle(locale),
  };
}

function dayPeriod(parts: readonly Intl.DateTimeFormatPart[]): string {
  return parts
    .filter((part) => part.type === "dayPeriod")
    .map((part) => part.value)
    .join("");
}

function resolveTime(locale: Locale): ResolvedTimePattern {
  const key = cacheKey(locale);
  const cached = TIME_CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(locale.tag, timeFormatOptions(locale));
  const morning = formatter.formatToParts(MORNING);
  const twelveHour = clockCycle(locale) === "h12";
  const am = twelveHour ? dayPeriod(morning) : "";
  const pm = twelveHour ? dayPeriod(formatter.formatToParts(AFTERNOON)) : "";

  const fields: TimeField[] = [];
  const literals = [""];
  for (const part of morning) {
    if (part.type === "hour" || part.type === "minute" || part.type === "dayPeriod") {
      fields.push(part.type);
      literals.push("");
    } else {
      literals[literals.length - 1] += part.value;
    }
  }

  const fieldToken: Readonly<Record<TimeField, Token>> = {
    hour: { kind: "digits", field: "hour", min: 1, max: 2 },
    minute: { kind: "digits", field: "minute", min: 2, max: 2 },
    dayPeriod: { kind: "dayPeriod", am: spacedTokens(am), pm: spacedTokens(pm) },
  };
  const tokens = literals.flatMap((literal, index): Token[] => {
    const field = fields[index];
    const text = spacedTokens(literal);
    return field === undefined ? text : [...text, fieldToken[field]];
  });

  const resolved = { pattern: { twelveHour, fields, literals, am, pm }, tokens, matcher: anchored(tokens) };
  TIME_CACHE.set(key, resolved);
  return resolved;
}

/**
 * The order and separators `locale` writes an hour-and-minute time with on its own hour cycle,
 * and its day-period markers, read from `Intl.DateTimeFormat#formatToParts` as
 * {@link resolveDatePattern} reads a date's. A locale whose cycle is `h11` or `h12` gets a
 * 12-hour pattern counting 01-12; one whose cycle is `h23` or `h24` gets a 24-hour pattern
 * counting 00-23.
 */
export function resolveTimePattern(locale: Locale): TimePattern {
  return resolveTime(locale).pattern;
}

/**
 * The time written in `locale`'s pattern: the hour and the minute padded to two digits, and on a
 * 12-hour clock the locale's marker for the half of the day, between the locale's own separators.
 * Midnight is `12:00 AM` on a 12-hour clock and `00:00` on a 24-hour one, never `24:00`.
 */
export function formatTime(time: ClockTime, locale: Locale): string {
  const { twelveHour, fields, literals, am, pm } = resolveTime(locale).pattern;
  const values: Readonly<Record<TimeField, string>> = {
    hour: String(twelveHour ? time.hour % 12 || 12 : time.hour).padStart(2, "0"),
    minute: String(time.minute).padStart(2, "0"),
    dayPeriod: time.hour < 12 ? am : pm,
  };
  return literals
    .map((literal, index) => {
      const field = fields[index];
      return field === undefined ? literal : literal + values[field];
    })
    .join("");
}

/**
 * The hour (0-23) and minute `str` writes in `locale`'s time pattern, or `undefined` when it does
 * not follow the pattern. On a 12-hour clock the hour must be 1-12 and the day-period marker one
 * of the locale's own, matched case-insensitively; `12 AM` is hour 0 and `12 PM` hour 12. On a
 * 24-hour clock the hour is returned as written, unchecked: `25:00` yields hour 25. The minute is
 * two digits and unchecked on either clock.
 *
 * Bidi marks are removed first, whitespace around the time is ignored, and a run of whitespace
 * inside the pattern matches any run of whitespace characters.
 */
export function parseTime(str: string, locale: Locale): ClockTime | undefined {
  const { pattern, matcher } = resolveTime(locale);
  const input = stripBidiMarks(str);
  const matches = matchTokens(matcher, input);
  if (matches === undefined) {
    return undefined;
  }

  const { hour, minute } = readDigits(matcher, matches, input) as Record<"hour" | "minute", number>;
  if (!pattern.twelveHour) {
    return { hour, minute };
  }
  if (hour < 1 || hour > 12) {
    return undefined;
  }
  return { hour: (hour % 12) + (matches.some((match) => match.pm) ? 12 : 0), minute };
}

/**
 * Where `combined` — a date and a time written together — holds `date` and `time`, each written
 * on its own: which comes first and the text before, between and after them.
 * {@link FALLBACK_LAYOUT} when either is missing or the two overlap.
 */
export function layoutDateTime(combined: string, date: string, time: string): DateTimeLayout {
  const dateAt = combined.indexOf(date);
  const timeAt = combined.indexOf(time);
  if (dateAt === -1 || timeAt === -1) {
    return FALLBACK_LAYOUT;
  }

  const timeFirst = timeAt < dateAt;
  const [firstAt, firstEnd] = timeFirst ? [timeAt, timeAt + time.length] : [dateAt, dateAt + date.length];
  const [secondAt, secondEnd] = timeFirst ? [dateAt, dateAt + date.length] : [timeAt, timeAt + time.length];
  if (firstEnd > secondAt) {
    return FALLBACK_LAYOUT;
  }
  return {
    timeFirst,
    literals: [combined.slice(0, firstAt), combined.slice(firstEnd, secondAt), combined.slice(secondEnd)],
  };
}

/**
 * {@link AFTERNOON} written by `Intl` under `options`, joined from `formatToParts` rather than read
 * from `format`: V8 replaces U+202F with a regular space in `format` but not in `formatToParts`,
 * and every other pattern here is read from the parts.
 */
function formatAfternoon(locale: Locale, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale.tag, options)
    .formatToParts(AFTERNOON)
    .map((part) => part.value)
    .join("");
}

function resolveDateTime(locale: Locale): ResolvedDateTimeLayout {
  const key = cacheKey(locale);
  const cached = DATE_TIME_CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const timeOptions = timeFormatOptions(locale);
  const layout = layoutDateTime(
    formatAfternoon(locale, { ...DATE_OPTIONS, ...timeOptions }),
    formatAfternoon(locale, DATE_OPTIONS),
    formatAfternoon(locale, timeOptions),
  );

  const dateStart: MarkToken = { kind: "mark" };
  const dateEnd: MarkToken = { kind: "mark" };
  const timeStart: MarkToken = { kind: "mark" };
  const timeEnd: MarkToken = { kind: "mark" };
  const date = [dateStart, ...resolve(locale).tokens, dateEnd];
  const time = [timeStart, ...resolveTime(locale).tokens, timeEnd];
  const [before, between, after] = layout.literals;
  const [first, second] = layout.timeFirst ? [time, date] : [date, time];
  const matcher = anchored([...spacedTokens(before), ...first, ...spacedTokens(between), ...second, ...spacedTokens(after)]);
  const resolved: ResolvedDateTimeLayout = {
    layout,
    matcher,
    date: [matcher.indexOf(dateStart), matcher.indexOf(dateEnd)],
    time: [matcher.indexOf(timeStart), matcher.indexOf(timeEnd)],
  };
  DATE_TIME_CACHE.set(key, resolved);
  return resolved;
}

/**
 * Where `locale` puts the time relative to the date when it writes both, and the text around
 * them, read from `Intl`'s own combined `formatToParts` output: the date-only and time-only
 * outputs are located within it, and what surrounds them is kept exactly as `Intl` emits it. When
 * the combined output does not hold the two as separate runs, the date comes first and a single
 * space separates them.
 */
export function resolveDateTimeLayout(locale: Locale): DateTimeLayout {
  return resolveDateTime(locale).layout;
}

/**
 * The date in `locale`'s numeric pattern ({@link formatDate}) and the time in its time pattern
 * ({@link formatTime}), placed as the locale's {@link resolveDateTimeLayout} places them.
 */
export function formatDateTime(date: CivilDate, time: ClockTime, locale: Locale): string {
  const { timeFirst, literals } = resolveDateTime(locale).layout;
  const dateText = formatDate(date, locale);
  const timeText = formatTime(time, locale);
  const [first, second] = timeFirst ? [timeText, dateText] : [dateText, timeText];
  return literals[0] + first + literals[1] + second + literals[2];
}

/**
 * The date text and the time text `str` holds in `locale`'s date-time layout, bidi marks removed,
 * or `undefined` when it does not follow the layout. Each half matches {@link parseDate}'s or
 * {@link parseTime}'s pattern but is not read into fields: the caller reads each with the parser
 * for its half. The text around the halves is matched as {@link parseTime} matches literals.
 */
export function parseDateTime(str: string, locale: Locale): DateTimeText | undefined {
  const { matcher, date, time } = resolveDateTime(locale);
  const input = stripBidiMarks(str);
  const matches = matchTokens(matcher, input);
  if (matches === undefined) {
    return undefined;
  }

  const between = ([from, to]: readonly [number, number]): string =>
    input.slice((matches[from] as TokenMatch).end, (matches[to] as TokenMatch).start);
  return { date: between(date), time: between(time) };
}
