# `Locale` replaces the string locale on `Numeric`, and is the locale argument for the types to come

`@vipengele/ts-core-common/locale` exports `Locale`, a class wrapping a canonicalized BCP 47 tag
(`new Locale("de-DE")`, `Locale.default()`) and the calendar and clock conventions it carries.
`Numeric.format`, `parse` and `tryParse` take an optional `Locale` and nothing else: a string is
not a locale argument, and an omitted one means `Locale.default()`. The date, time and other
locale-aware types that follow take a `Locale` the same way.

An invalid tag is rejected where the `Locale` is built: `new Locale(tag)` throws a `RangeError`
for a tag that is not well-formed, `""` included. `Numeric` has no invalid-locale path of its own
any more, so its three methods fail only for the reasons about the number itself
(`NumericParseError`).

Parsing a tag is paid once, at construction, and the `Numeric` caches (separator characters,
`Intl.NumberFormat` instances) are keyed by `Locale#tag`, so two `Locale` instances for one
canonical tag share an entry.

The change removes an accepted argument type, so it is breaking; while the package is pre-1.0
that is a minor version bump.

## Why a class and not a tag string

A bare string carries nothing but the tag. Month and weekday names, the hour cycle and the first
day of the week are properties of a locale that every date-shaped type needs, and each would
re-derive them from `Intl` on its own. `Locale` computes them in one place, with one fallback for
engines that expose no week info, and every type agrees on the answer.

## Considered options

- **A `string | Locale` union.** Every locale-aware function would accept both, and every one would
  have to normalize the string itself, each with its own idea of what an invalid tag does. A
  string is also where an uncanonicalized or misspelled tag goes unnoticed until a call deep
  inside a formatter. A single type moves validation to one constructor and keeps every signature
  one type wide.
- **Keep the string overload, deprecated, beside the `Locale` overload.** Pre-1.0 is when a
  signature can change at the cost of a minor bump. A deprecated overload would keep the two
  paths, and the duplicated validation, in every release until 1.0, and a consumer with no reason
  to migrate would never see the deprecation matter. The cost of removing it now is a one-line
  change at each call site: `new Locale(tag)`.
