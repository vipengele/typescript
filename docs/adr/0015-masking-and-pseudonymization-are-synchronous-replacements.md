# Masking and pseudonymization are synchronous Replacements with their own HMAC

`@vipengele/ts-core-redaction` exports two factories, each returning a `Replacement`:

```ts
function maskKeepLast(keep: number, options?: MaskOptions): Replacement;
function pseudonymize(options: PseudonymizeOptions): Replacement;
```

`maskKeepLast(4)` turns `"4242424242424242"` into `"**** 4242"`; `pseudonymize({ key })` turns a value
into `pseud_<hex>`, the first 16 hex characters of its HMAC-SHA-256, so redacted records still
correlate. They add no mode and no field: the `Replacement` signature is unchanged, as ADR-0014
anticipated, and they are usable wherever a `Replacement` is: the `replacement` option of `redact`,
`redactUrl`, `redactQueryString` and `redactHeaders`. The logger passes a policy and never a
replacement, so it cannot use them.

## The HMAC is a synchronous pure-JavaScript implementation in the package

`redact` is synchronous and a `Replacement` returns its value directly, so the digest has to be
computed synchronously. The package carries its own SHA-256 and HMAC-SHA-256 (`src/hmac-sha256.ts`,
internal and not exported), checked against the RFC 4231 and NIST vectors and against `node:crypto`
in a Node-only suite.

## The key is checked once, at build time

`pseudonymize` throws a built-in `TypeError` when `key` is not a non-empty string or `Uint8Array`.
The check runs when the Replacement is built, never per value: a throw inside `redact` makes the
logger drop the record silently, and a key that is wrong is wrong for every value. ADR-0002's
`VipengeleError` is not importable here, since the package has no runtime dependencies and may not
import `@vipengele/ts-core-common`. Every other bad option (`keep`, `length`, `prefix`, `maskChar`)
clamps or takes its default and never throws.

## The mask run has a fixed length

The hidden part is always four mask characters, then a space, then the tail. A run as long as the
hidden part would reveal the value's length, and the length of a card number or a token narrows what
it can be. The default mask character is `*` and not `•`: U+2022 is outside Latin-1, and a `Headers`
value that holds it is rejected, so `redactHeaders` would store `"[REDACTED]"` for the header.
Masking cuts UTF-16 code units, as `truncateString` does, so a cut can split a surrogate pair.

## A primitive is converted with `String()` first

A value under a matched key reaches the Replacement raw, so `4242` and `"4242"` are different
inputs to a Replacement that hashes or slices. Converting primitives with `String()` makes them
agree: the two share a mask and a token, and `null` and `undefined` become `"null"` and
`"undefined"`. An object, array, function or boxed string has no string form worth keeping or
correlating on, and becomes `"[REDACTED]"`. Hashing encodes with `TextEncoder`, so a lone surrogate
becomes U+FFFD.

## Considered options

- **WebCrypto's HMAC.** It is async-only, so `redact` would have to return a promise.
- **An async `redactAsync` beside `redact`.** The logger redacts synchronously on the logging path
  and could never call it, so the one consumer that matters would be left out.
- **`node:crypto` through export conditions.** ADR-0004 chooses runtime code by lazy feature
  detection in one build per package, not by conditional exports, and shipped `src` never imports a
  `node:` specifier.
- **A caller-supplied hash function.** Every caller would write the HMAC and the key handling, and
  there would be no one-argument `key` option.
- **A dependency, or `@vipengele/ts-core-common`.** The package has zero runtime dependencies and
  does not import its sibling.
- **A `VipengeleError` subclass for a bad key.** It cannot be imported, and a one-off error class
  here would break the shared `code` convention.
- **A mask as long as the hidden part.** It leaks the value's length.
- **`•` as the default mask character.** It is rejected by `Headers`.
- **A zero-length pseudonym.** Every value would share the empty token, so `length` is clamped to
  1..64.
