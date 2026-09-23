import { resolveLocaleParts } from "./locale-parts";
import { NumericParseError } from "./numeric-parse-error";

/** The outcome of {@link tryParse}. `value` is present exactly when `success` is `true`. */
export interface TryParseResult {
  /** Whether the string spelled a number. */
  readonly success: boolean;
  /** The parsed number, on success. */
  readonly value?: number;
}

/**
 * Invisible characters that carry no numeric meaning and are dropped before anything is read.
 * `ar-EG` and `fa-IR` prefix a *negative* number with U+200E, which a reader that only knows the
 * locale's group, decimal and minus characters would reject — and so would fail on the very
 * string the same locale's `format` produced. The set is by character, not by locale, because
 * which locales emit such a mark moves between ICU versions.
 */
const INVISIBLE_MARKS = new Set(["‎", "‏", "؜", "​", "﻿"]);

/**
 * The ASCII character a keyboard produces in place of a separator no keyboard can type. `sv-SE`
 * negates with U+2212 and groups with U+00A0, `fr-FR` groups with U+202F: accepting only what
 * `format` emits rejects everything a person actually types. Separators that are already ASCII —
 * every locale's decimal separator, and `de-CH`'s U+0027 apostrophe group separator — stand for
 * themselves.
 */
const ASCII_EQUIVALENTS = new Map([
  ["−", "-"],
  ["–", "-"],
  ["‐", "-"],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  ["’", "'"],
  ["ʼ", "'"],
]);

function asciiEquivalent(separator: string): string {
  return ASCII_EQUIVALENTS.get(separator) ?? separator;
}

/**
 * Reads `str` under `locale`, or `undefined` when it does not spell a number.
 *
 * Group separators are removed wherever they sit, without checking that the groups they delimit
 * are of a consistent size: `en-IN` groups as `1,23,45,678`, so validating positions against a
 * three-digit pattern would reject that locale's own output.
 *
 * Everything that survives the removals has to be an ASCII digit or the single decimal
 * separator. Handing the string to `Number` instead would read `""`, `"  "` and `"0x10"` as
 * numbers.
 */
function parseValue(str: string, locale?: string): number | undefined {
  const { group, decimal, minus } = resolveLocaleParts(locale);

  let text = "";
  for (const character of str) {
    if (!INVISIBLE_MARKS.has(character)) {
      text += character;
    }
  }
  text = text.trim();

  let negative = false;
  if (text[0] === minus || text[0] === asciiEquivalent(minus)) {
    negative = true;
    text = text.slice(1);
  }

  const groupAscii = asciiEquivalent(group);
  const decimalAscii = asciiEquivalent(decimal);
  let digits = "";
  let digitCount = 0;
  let decimalCount = 0;

  for (const character of text) {
    if (character === group || character === groupAscii) {
      continue;
    }
    if (character === decimal || character === decimalAscii) {
      decimalCount += 1;
      digits += ".";
      continue;
    }
    if (character < "0" || character > "9") {
      return undefined;
    }
    digitCount += 1;
    digits += character;
  }

  if (digitCount === 0 || decimalCount > 1) {
    return undefined;
  }

  const value = Number(digits);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return negative ? -value : value;
}

/**
 * Reads the number `str` spells in `locale`, or in the runtime's default locale when `locale` is
 * omitted. Both the locale's own separator characters and their ASCII equivalents are accepted,
 * so `format`'s output and a retyping of it on an ASCII keyboard read back the same value.
 *
 * Digits are ASCII 0-9 only, matching `format`'s forced `numberingSystem: "latn"`. A string
 * written in another numbering system — Arabic-Indic, Devanagari — does not parse.
 *
 * @throws {RangeError} when `locale` is not a structurally valid BCP 47 language tag. An invalid
 * tag is a programmer error, not a parse failure, so it propagates unwrapped.
 * @throws {NumericParseError} when `str` does not spell a number in `locale`.
 */
export function parse(str: string, locale?: string): number {
  const value = parseValue(str, locale);

  if (value === undefined) {
    throw new NumericParseError(`Cannot parse ${JSON.stringify(str)} as a number.`);
  }

  return value;
}

/**
 * The non-throwing counterpart of {@link parse}: an unparseable `str` yields
 * `{ success: false }` rather than a {@link NumericParseError}.
 *
 * @throws {RangeError} when `locale` is not a structurally valid BCP 47 language tag. An invalid
 * tag is a programmer error rather than a parse failure, so it propagates out of here too
 * instead of turning into an unsuccessful result.
 */
export function tryParse(str: string, locale?: string): TryParseResult {
  const value = parseValue(str, locale);

  return value === undefined ? { success: false } : { success: true, value };
}
