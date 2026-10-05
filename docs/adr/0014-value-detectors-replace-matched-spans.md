# Value detectors live on the policy and replace only the span they match

`RedactionPolicy` has an optional `detectors` beside `keys` and `except`:

```ts
interface Detector {
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

interface RedactionPolicy {
  keys: readonly KeyMatcher[];
  except?: readonly KeyMatcher[];
  detectors?: readonly Detector[];
}
```

A key rule finds a secret by where it sits; a detector finds one by what it looks like, so it
catches a token inside a log message or a free-text field that no key names. `redact` scans every
string it visits, never a key, and replaces each span a detector matches. `validate`, when present,
confirms a candidate match before it is replaced. A string under a key the policy redacts is
replaced whole and is not scanned.

`@vipengele/ts-core-redaction` exports the built-ins `jwt`, `bearerToken`, `creditCard`, `email`,
`awsAccessKey`, `githubToken` and `stripeKey`, and `valueDetectors`, the preset holding all of them.
They are root exports, re-exported by `@vipengele/ts`.

## Detectors belong to the policy

Because `detectors` is a policy field, `composePolicies` concatenates the parts' detectors as it does
their `keys`, and the logger applies them through whatever policy it is configured with, with no
wiring of its own (ADR-0011).

## Only the matched span is replaced

A match is replaced and the text around it is kept: `contact [REDACTED] for access` stays readable
as a message. This differs from ADR-0012, where a matched header's value is replaced whole. That
rule is scoped to header values, where the name already says the whole value is a secret and a
kept fragment such as an auth scheme can carry one. A detector fires on a shape found inside text
of unknown purpose.

## The replacement signature is unchanged

A function `Replacement` receives `(value, key)`. For a detected span, `value` is the span and `key`
is the nearest enclosing string key on the path to the string: the key of its field or `Map` entry,
or the one its keyless container (an array, a `Set`) sits under, and `""` at the root. A return
value that is not a string is converted with `String()`, since it is spliced into text.

## Scan, then truncate

The scan reads the whole string and `maxStringLength` then cuts the result. A secret that straddles
the cutoff is matched in full and replaced, so no prefix of it survives. The cost is that, with
detectors on, the work per string is no longer bounded by the characters kept. Each built-in is
anchored so its cost is linear in the string's length and a hostile string cannot make it backtrack
without limit; a token pattern has no length bound, so an oversized token is covered whole rather
than missed or cut short. A pattern
a caller supplies is a trust boundary: its cost is the caller's to bound.

## `Detector` is an open type

A `Detector` is a plain `{ pattern, validate? }` a caller can write. It has no `name` field, because
nothing consumes one: the replacement receives the span, not the detector that found it.

## Out of scope

- `redactUrl`, `redactQueryString` and `redactHeaders` ignore `detectors`. They read their input as
  text by structure, and ADR-0012 replaces a matched header value whole, so a scan would have no
  span left to find.
- The logger scans a record's `attributes` and an error's `data` through its policy. A real
  `Error`'s `message` and `stack`, a record's `message`, and a thrown string that is not JSON stay
  unscanned. A secret written into one of those reaches a sink as written.

## Considered options

- **A `RedactOptions` field.** Options do not compose: a preset could not carry its detectors, and
  `composePolicies` would have nothing to combine. The logger would need its own setting beside its
  policy.
- **Replace the whole value when a detector matches.** One email address would erase an entire log
  message. ADR-0012's whole-value rule holds for header values only.
- **Widen `key` to `string | undefined`.** A root string has no key, and `undefined` would say so,
  but it is a breaking change to a public type every function `Replacement` already satisfies.
  `""` at the root keeps the signature as it is.
- **A separate `onMatch` callback.** A second way to say what a match becomes, beside
  `Replacement`, when partial masking and pseudonymization are already Replacements.
- **Truncate, then scan.** A secret straddling the cutoff is cut into a prefix no pattern matches,
  and the prefix is kept. Scanning first costs more work and leaks nothing.
- **A `name` on `Detector`.** Nothing would read it.
- **Built-in detectors only.** An application has shapes of its own, such as an internal token
  format, and would have no way to add one.
