/**
 * The characters a locale spells a number with: the group separator, the decimal separator and
 * the minus sign.
 */
export interface LocaleParts {
  /** The character between digit groups — `,` in `en-US`, U+202F in `fr-FR`. */
  readonly group: string;
  /** The character before the fractional part — `.` in `en-US`, `,` in `sv-SE`. */
  readonly decimal: string;
  /** The character marking a negative value — `-` in `en-US`, U+2212 in `sv-SE`. */
  readonly minus: string;
}

/**
 * Negative, grouped and fractional, so one `formatToParts` call yields all three part types.
 * A value without a fraction emits no `decimal` part, and one below the locale's grouping
 * threshold emits no `group` part.
 */
const REPRESENTATIVE_VALUE = -12345678.9;

/**
 * Keyed by locale exactly as passed, `undefined` included as its own key. `""` is itself a
 * locale argument — an invalid one, which `Intl.NumberFormat` rejects — so it cannot share a key
 * with the omitted case without a call missing its `RangeError`. A locale's separator characters
 * don't change within a single process — only ICU version affects them, and that's fixed for the
 * process's lifetime — so caching here avoids building an `Intl.NumberFormat` on every
 * `format`/`parse` call.
 */
const CACHE = new Map<string | undefined, LocaleParts>();

/**
 * Reads a locale's separator characters out of the runtime's own CLDR data.
 *
 * None of these characters can be assumed: `sv-SE` negates with U+2212 rather than
 * hyphen-minus, `fr-FR` groups with U+202F and `sv-SE` with U+00A0 rather than a plain space,
 * and `de-CH` groups with an apostrophe. Which character a locale uses also moves between ICU
 * versions, so it is derived from `Intl` rather than tabulated here.
 *
 * `numberingSystem: "latn"` pins the digits to ASCII; the separators stay locale-specific.
 *
 * Part types other than the three read here are ignored, which matters for `ar-EG` and `fa-IR`:
 * they prefix the output with a `literal` part holding U+200E.
 *
 * @throws {RangeError} when `locale` is not a structurally valid BCP 47 language tag.
 */
export function resolveLocaleParts(locale?: string): LocaleParts {
  const cached = CACHE.get(locale);
  if (cached !== undefined) {
    return cached;
  }

  const parts = new Intl.NumberFormat(locale, {
    numberingSystem: "latn",
    maximumFractionDigits: 1,
  }).formatToParts(REPRESENTATIVE_VALUE);

  let group = "";
  let decimal = "";
  let minus = "";

  for (const part of parts) {
    if (part.type === "group") {
      group = part.value;
    } else if (part.type === "decimal") {
      decimal = part.value;
    } else if (part.type === "minusSign") {
      minus = part.value;
    }
  }

  const resolved = { group, decimal, minus };
  CACHE.set(locale, resolved);
  return resolved;
}
