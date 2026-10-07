# @vipengele/ts-core-redaction

Removes secrets and personal data from structured values before they are logged, reported or sent
anywhere, by matching keys against a policy, bounding how deep, wide and long the walk goes. Keys
are the default; opt-in value detectors also replace secret-shaped spans inside string values.
Usable on its own, and the redaction layer of `@vipengele/ts-core-observability`.

```sh
pnpm add @vipengele/ts-core-redaction
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

## `redact`

```ts
import { redact, type RedactionPolicy } from "@vipengele/ts-core-redaction";

const policy: RedactionPolicy = { keys: ["password", "authorization"] };

redact({ user: "ana", password: "hunter2" }, policy);
// => { user: "ana", password: "[REDACTED]" }
```

```ts
function redact(value: unknown, policy: RedactionPolicy, options?: RedactOptions): unknown;
```

Returns a redacted copy of `value`. Every value found under a key the policy matches is replaced
whole and never descended into; everything else is walked recursively, and the strings in it are
scanned by the policy's `detectors`, if it has any. Plain objects, arrays,
`Map`s, `Set`s, `Error`s and other class instances come back as copies; `Date`s, `RegExp`s, boxed
primitives, `ArrayBuffer`s and their views, functions and primitives are returned as-is. The input
is never mutated.

`RedactOptions.replacement` controls what a matched value is replaced with; see `Replacement`
below. It defaults to the string `"[REDACTED]"`.

## `RedactionPolicy` and `KeyMatcher`

```ts
interface RedactionPolicy {
  keys: readonly KeyMatcher[];
  except?: readonly KeyMatcher[];
  detectors?: readonly Detector[];
}

type KeyMatcher =
  | string
  | RegExp
  | { pattern: string | RegExp; caseInsensitive?: boolean; segments?: never }
  | { segments: string; pattern?: never; caseInsensitive?: never };
```

A policy is a list of `KeyMatcher`s, each naming keys whose values are sensitive. A key is
redacted if and only if a matcher in `keys` matches it and no matcher in `except` does. `except`
is optional and carves exemptions out of a broad rule; it takes the same `KeyMatcher`s as `keys`.
`detectors` is optional and off by default; see `Detector` below. A policy without it behaves as a
key-only policy.

- A bare `string` matches a key exactly and case-sensitively.
- A bare `RegExp` is tested against the key with its own flags.
- The object form, `{ pattern, caseInsensitive? }`, wraps either a string or a `RegExp` pattern and
  adds `caseInsensitive`, which case-insensitively matches the string or applies the `i` flag to
  the pattern.
- The `{ segments: string }` form matches by word rather than by character; see below.

```ts
const policy: RedactionPolicy = {
  keys: ["password", /token/, { pattern: "email", caseInsensitive: true }],
  except: ["tokenCount"],
};
```

### `{ segments }`

The key and the spec are each tokenized into lower-cased segments:

- at every character that is not a letter or a digit,
- at a lower-to-upper case change, and before the last capital of an acronym run, and
- around every run of digits, so each digit run is its own segment.

The key matches when the spec's segments appear contiguously among the key's own segments.
Segmenting is always case-insensitive, so `caseInsensitive` alongside `segments` is a type error. A
spec with no letters or digits (empty, or only whitespace and punctuation) has no segments, matches
no key, and does not throw.

| Key             | Segments              | `{ segments: "api key" }` | `{ segments: "token" }` | `{ segments: "session" }` | `{ segments: "secret" }` |
| --------------- | --------------------- | ------------------------- | ----------------------- | ------------------------- | ------------------------ |
| `APIKey`        | `api`, `key`          | matches                   |                         |                           |                          |
| `x-api-key`     | `x`, `api`, `key`     | matches                   |                         |                           |                          |
| `OAuthToken`    | `o`, `auth`, `token`  |                           | matches                 |                           |                          |
| `oauth2Token`   | `oauth`, `2`, `token` |                           | matches                 |                           |                          |
| `csrfToken`     | `csrf`, `token`       |                           | matches                 |                           |                          |
| `tokenizer`     | `tokenizer`           |                           | does not match          |                           |                          |
| `session2`      | `session`, `2`        |                           |                         | matches                   |                          |
| `api_secret_key` | `api`, `secret`, `key` | does not match (not contiguous) |                    |                           | matches                  |

`{ segments: "oauth" }` does not match `OAuthToken`, since `oauth` is not one of its segments.

```ts
const policy: RedactionPolicy = {
  keys: [{ segments: "api key" }, { segments: "token" }],
  except: [{ segments: "token count" }],
};
```

## `secretKeys`

```ts
const secretKeys: RedactionPolicy;
```

A frozen `RedactionPolicy` preset for the keys that conventionally hold credentials. Every entry
is a `{ segments }` matcher for one of: `password`, `passwd`, `pwd`, `secret`, `token`,
`authorization`, `cookie`, `api key`, `private key`, `access key`, `session`, `credential`,
`bearer`. So `token` also covers `refresh_token` and `csrfToken`, `cookie` covers `Set-Cookie`, and
`api key` covers `x-api-key` and `APIKey`.

Bare `auth` and `key` are excluded as too broad: `auth` matches `auth.method` and `authMode`, and
`key` matches every `primaryKey` and `cacheKey`. Compose either in with `composePolicies` when an
application wants it.

```ts
import { redact, secretKeys } from "@vipengele/ts-core-redaction";

redact({ user: "ana", "x-api-key": "k-123" }, secretKeys);
// => { user: "ana", "x-api-key": "[REDACTED]" }
```

## `composePolicies`

```ts
function composePolicies(...parts: RedactionPolicy[]): RedactionPolicy;
```

Returns a new frozen policy whose `keys` are every part's `keys`, whose `except` is every
part's `except` and whose `detectors` are every part's `detectors`, each in order. The `detectors`
field is omitted when no part has any. The parts are never mutated. `except` is policy-wide after
composition: an exemption from one part also exempts a key another part matches.

```ts
import { composePolicies, redact, secretKeys } from "@vipengele/ts-core-redaction";

const policy = composePolicies(secretKeys, {
  keys: [{ segments: "auth" }],
  except: ["tokenCount"],
});
```

Compose once at startup and reuse the result. A policy is normalized once per object, and
`composePolicies` returns a new object on every call, so composing per call re-normalizes every
matcher every time.

## `Detector` and value detectors

```ts
interface Detector {
  pattern: RegExp;
  validate?: (match: string) => boolean;
}
```

Key rules cannot see a secret that sits inside a string under an innocent key, such as a token in a
log line or an email in a `note` field. A policy's `detectors` find those by value. Detectors are
off by default: a policy without `detectors` behaves exactly as a key-only policy.

```ts
import { composePolicies, redact, secretKeys, valueDetectors } from "@vipengele/ts-core-redaction";

const policy = composePolicies(secretKeys, { keys: [], detectors: valueDetectors });

redact({ note: "retry with Bearer abc.def-123 failed", password: "hunter2" }, policy);
// => { note: "retry with [REDACTED] failed", password: "[REDACTED]" }
```

A custom detector is a `pattern` plus an optional `validate`, run on each raw match to reject
false positives:

```ts
import { composePolicies, redact, secretKeys, type Detector } from "@vipengele/ts-core-redaction";

const orderId: Detector = {
  pattern: /\bORD-\d{8}\b/,
  validate: (match) => !match.endsWith("00000000"),
};

redact("shipped ORD-12345678", composePolicies(secretKeys, { keys: [], detectors: [orderId] }));
// => "shipped [REDACTED]"
```

### Built-in detectors

Each is exported from the package root.

| Detector       | Matches                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `jwt`          | A JSON Web Token, to the end of its signature however long its segments are.                                                   |
| `bearerToken`  | A `Bearer` token, to the end of the token however long; the span includes the `Bearer` scheme.                                 |
| `creditCard`   | 13 to 19 contiguous digits, or 4-4-4-N, Diners 4-6-4 or Amex 4-6-5 groups with one space or hyphen separator, validated with the Luhn check. |
| `email`        | An email address.                                                                                                              |
| `awsAccessKey` | An AWS access key ID.                                                                                                          |
| `githubToken`  | A GitHub token.                                                                                                                |
| `stripeKey`    | A Stripe secret or restricted key; publishable keys are not matched.                                                           |

`valueDetectors` is a frozen array bundling all seven. Each built-in pattern costs time linear in
the string's length: an unbounded quantifier repeats one character class behind a leading anchor
that rejects a start position inside the run at once, and every other quantifier is length-bounded.

`creditCard` leaves a CVV or an expiry date written after the number (`4111 1111 1111 1111 123`)
out of the candidate, so the card number is still checked and redacted on its own. A longer grouped
number is read by its leading groups instead: when its first 13 to 19 digits happen to pass the
Luhn check, that prefix is redacted and the rest kept; when they fail it, the number is retried
from each later group, so a card number written after a reference or another number is still
found. A 19-digit number is matched whole when written
contiguously; written in 4-4-4-4-3 groups it is redacted only when its leading 16 digits pass Luhn
or its trailing 15 do, since trying that grouping first would leave a card number written next to
its CVV unredacted.

### What is scanned

`redact` scans every string it visits: object field values, array items, `Set` members, `Map`
values, an `Error`'s `name`, `message`, `stack` and `cause` strings, and a root string. Object and
`Map` keys are never scanned. A value under a key the policy already redacts is replaced whole by
the key rule and not scanned.

- **Only the matched span is replaced.** The text around it is kept. Overlapping or touching spans,
  from one detector or several, merge into one replacement. `validate` runs on each detector's raw
  match before merging.
- **A rejected match is rescanned from its next character.** An accepted match resumes the scan at
  its end; a match `validate` rejects resumes it one character (one code point under `u` or `v`)
  past its start, so a secret starting inside the rejected text is still found.
- **A function `Replacement` receives the span as `value`** and the nearest enclosing string key as
  `key`: `""` for a root string and for items under no string key. A non-string return is
  converted with `String()`.
- **A detector's regex is copied, never run as given.** The copy gets the `g` flag, loses `y`, and
  keeps `u` and `v`; the caller's `lastIndex` is untouched. Detectors are normalized once per
  `detectors` array, so mutating the array after use has no effect. Compose a new policy instead.
- **The scan reads the original string, and `maxStringLength` truncates the result.** A secret
  that straddles the cutoff is replaced before the cut, so no prefix of it survives.
- **`redactUrl`, `redactQueryString` and `redactHeaders` ignore `detectors`.** They replace whole
  parameter and header values by name.

Value patterns complement key rules and do not replace them. A pattern can match benign text, such
as an email address in prose or a run of digits that happens to pass the Luhn check, and it cannot
see a secret in a shape it does not know.

## `Replacement`

```ts
type Replacement = string | ((value: unknown, key: string) => unknown);
```

What a matched value is replaced with, either:

- a fixed `string`, used as-is for every match, or
- a function, called for every matched value with `(value, key)`, whose return value replaces it.
  For a detector match, `value` is the matched span.

There is no third mode where a function is called once to produce a single, shared replacement —
a function `Replacement` runs per match, every time.

```ts
redact(payload, policy, { replacement: (value, key) => `[REDACTED:${key}]` });
```

`maskKeepLast` and `pseudonymize` build ready-made function Replacements; see below.

## `maskKeepLast` and `pseudonymize`

Two factories that return a `Replacement`, for values that should stay recognisable or
correlatable without being readable.

```ts
import { maskKeepLast, pseudonymize, redact } from "@vipengele/ts-core-redaction";

redact({ card: "4242424242424242" }, { keys: ["card"] }, { replacement: maskKeepLast(4) });
// => { card: "**** 4242" }

redact({ email: "ana@example.com" }, { keys: ["email"] }, { replacement: pseudonymize({ key: secret }) });
// => { email: "pseud_3f2a9c0d1e4b5a67" }
```

```ts
function maskKeepLast(keep: number, options?: MaskOptions): Replacement;
function pseudonymize(options: PseudonymizeOptions): Replacement;

interface MaskOptions {
  maskChar?: string;
}

interface PseudonymizeOptions {
  key: string | Uint8Array;
  prefix?: string;
  length?: number;
}
```

| Option     | Default   | Meaning                                                                                  |
| ---------- | --------- | ---------------------------------------------------------------------------------------- |
| `keep`     | required  | UTF-16 code units kept from the end of the value.                                        |
| `maskChar` | `"*"`     | The character the mask run is made of; only its first code point is used.                |
| `key`      | required  | The HMAC key: a non-empty string (UTF-8) or a non-empty `Uint8Array`.                    |
| `prefix`   | `"pseud_"` | What every token starts with.                                                           |
| `length`   | `16`      | Hex characters of the HMAC-SHA-256 digest kept after the prefix, clamped to 1..64.       |

- **The mask run is always four characters.** `maskKeepLast(4)` turns `"4242424242424242"` and
  `"4242 4242"` alike into `"**** 4242"`, so the result never shows how long the value was. A value
  no longer than `keep`, an empty string included, becomes the bare run `"****"`, and so does every
  value when `keep` is `0`, negative, `NaN` or `Infinity`. A fraction is floored. A bad `keep` or
  `maskChar` never throws.
- **A pseudonym is `<prefix><hex>`**: the first `length` hex characters of the HMAC-SHA-256 of the
  value under `key`. The same value under the same key always gives the same token, so redacted
  records still correlate, and a reader without the key cannot recompute a token from a guess.
  Different keys give different tokens. A bad `prefix` or `length` falls back or clamps and never
  throws; `0` is never used, since every value would then share one token.
- **A bad key throws a `TypeError` when `pseudonymize` is called**, never from the returned
  Replacement, which does not throw: an empty or wrongly typed `key` is rejected at build time. A
  `Uint8Array` key is copied, so changing the caller's array later does not change the tokens.
- **A primitive goes through `String()` first**, so `4242` and `"4242"` mask to the same text and
  share a token. `null` and `undefined` are stringified too: `maskKeepLast(4)` of `undefined` is
  `"**** ined"`, and `pseudonymize` gives `undefined` the token of `"undefined"`. An object, array,
  function or boxed string has no string form worth keeping or correlating on and becomes
  `"[REDACTED]"`.
- **Hashing is UTF-8 through `TextEncoder`.** A lone surrogate becomes U+FFFD, so two strings that
  differ only in which lone surrogate they hold share a token. A string key is encoded the same
  way.
- **Masking cuts UTF-16 code units**, as `maxStringLength` does, so the tail can start between the
  two halves of a surrogate pair and keep a lone low surrogate.
- **`maskChar` should stay within Latin-1.** The default `*` is. A `Headers` value must be a byte
  string, so a mask run of `"•"` (U+2022) or any other character outside Latin-1 makes
  `redactHeaders` store `"[REDACTED]"` for that header instead.
- **The Replacement holds the key in memory** for as long as it is reachable, and nothing redacts
  the key itself. Keep it out of anything that is logged or redacted.
- **They apply through the `replacement` option of `redact`, `redactUrl`, `redactQueryString` and
  `redactHeaders` only.** The logger passes a policy and never a replacement, so it cannot use
  them; a record it writes is redacted with `"[REDACTED]"`.

## `redactUrl`, `redactQueryString` and `redactHeaders`

`redact` walks structured values by key. Secrets in transit sit in strings and header lists
instead, so three helpers redact those. They share one options type and read their input as text
or as a header list; none of them throws on its contents or mutates its input.

```ts
import { redactHeaders, redactQueryString, redactUrl } from "@vipengele/ts-core-redaction";

redactUrl("https://bob:pw@example.com/p?token=abc&page=2#access_token=x");
// => "https://[REDACTED]:[REDACTED]@example.com/p?token=[REDACTED]&page=2#access_token=[REDACTED]"

redactQueryString("?refresh_token=abc&page=2");
// => "?refresh_token=[REDACTED]&page=2"

redactHeaders({ Authorization: "Bearer x", Accept: "text/plain" });
// => { Authorization: "[REDACTED]", Accept: "text/plain" }
```

```ts
function redactUrl(url: string, options?: RedactStringOptions): string;
function redactQueryString(query: string, options?: RedactStringOptions): string;
function redactHeaders(headers: Headers, options?: RedactStringOptions): Headers;
function redactHeaders(headers: HeaderTuples, options?: RedactStringOptions): HeaderTuples;
function redactHeaders(headers: HeaderRecord, options?: RedactStringOptions): HeaderRecord;

interface RedactStringOptions {
  policy?: RedactionPolicy;
  replacement?: Replacement;
  maxStringLength?: number;
  maxBreadth?: number;
}

type HeaderRecord = Record<string, string | string[]>;
type HeaderTuples = [string, string][];
```

### Options

| Option            | Default      | Meaning                                                                                       |
| ----------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `policy`          | `secretKeys` | Which parameter or header names have their values redacted.                                   |
| `replacement`     | `"[REDACTED]"` | What a matched value is replaced with; see `Replacement`.                                   |
| `maxStringLength` | `8192`       | UTF-16 code units kept of the redacted URL or query string, or of each header value.          |
| `maxBreadth`      | `100`        | Parameters kept in a query string, or headers kept in a header list.                          |

The limit defaults are the ones `redact` uses, and the same markers apply: `"…[truncated]"` ends a
cut string and `"[Truncated: N more]"` stands for the parameters or headers left out. There is no
`maxDepth`, since a string has no nesting. Redaction runs first and truncation after, so a secret
past the cut is still replaced. A function `Replacement` receives the percent-decoded value and the
key described below; a non-string return is converted with `String()` and written as-is, without
percent-encoding.

### `redactUrl`

Returns `url` with its userinfo replaced and the value of every query and fragment parameter whose
name the policy matches replaced.

- **Userinfo is always redacted, whatever the policy.** `https://bob:pw@host` becomes
  `https://[REDACTED]:[REDACTED]@host`, and a username with no password gives
  `https://[REDACTED]@host`. A function `Replacement` is called with key `"username"` or
  `"password"`.
- **Userinfo is found the way a WHATWG parser finds it, and fails closed.** It follows `scheme://`
  or two leading separators, each `/` or `\` (`//host`, `\\host`, `/\host`), and for a special scheme (`http`, `https`, `ws`, `wss`, `ftp`, `file`, in any
  case) any run of `/` and `\`, so `https:u:pw@host` and `https:\\u:pw@host` are redacted; a tab,
  LF or CR in the scheme or between the slashes is ignored. When the authority has the `user:pass`
  shape (a `:` before the first `/`, `?` or `#`), the userinfo runs to its first `@`, and on through
  any further `@` before the next `/`, `?` or `#`. A password holding an unencoded `#`, `?`, `/` or
  `@` is replaced whole, and an `@` in the path or query after it (`https://u:pw@host/x?e=a@b`) is
  kept. A host with a port and a later `@` (`https://host:8080/a@b`) has the same shape and is
  over-redacted up to that `@`. Without a `:`, an `@` in the path, query or fragment
  (`https://host/p@x`, `https://host?e=a@b`) is not userinfo.
- **The URL is read as text and never parsed into a `URL`.** Relative, scheme-less,
  protocol-relative and malformed input is accepted, and every byte outside a redacted value is
  kept as written: `%20` stays `%20`, `+` stays `+`, `~` and `!` stay unencoded, separators and
  empty segments stay. Re-serialising through `URLSearchParams` would rewrite all of those.
- **Parameter names are decoded before matching**: `%` escapes are decoded and `+` is a space, so
  `to%6Ben=x` matches `token`. A name that cannot be decoded (a malformed `%` escape) has its value
  redacted, so an undecodable name fails closed. A function `Replacement` receives the decoded name
  as its key.
- **A segment without `=` is kept**, since it holds no value. A repeated name is redacted every
  time it appears.
- **A fragment is a parameter list only if it holds a `name=value` pair with a non-empty name.**
  `#access_token=x` is one, so its matched values are redacted; `#section-2` and `#=` are not, and
  are kept whole. A parameter list in a fragment is matched like a query, so
  `#access_token=x&token_type=bearer` redacts both values, as `secretKeys` matches `token_type` by
  its `token` word.
- `maxBreadth` bounds the query and the fragment separately.

### `redactQueryString`

Returns `query` with matched parameter values replaced, under the rules above. A leading `?` is
accepted and kept; without one the input is the bare parameter list.

### `redactHeaders`

Returns the kind it was given: a new `Headers` for a `Headers`, a new record for a record, new
`[name, value]` pairs for pairs.

- **A matched header has its whole value replaced.** No scheme is kept (`Bearer` goes with the
  token) and no cookie is parsed.
- **Every `Set-Cookie` entry is replaced on its own.** A `Headers` is read through iteration, never
  `get("set-cookie")`, which joins cookies with `", "` and is ambiguous. A function `Replacement`
  receives `"set-cookie"` as the key of a cookie entry, whatever its casing.
- **Names keep their casing in records and pairs**, and names that differ only in case are separate
  entries. A `Headers` lower-cases names, so with a `Headers` input a string matcher in the policy
  matches the lower-cased name (`"authorization"`, not `"Authorization"`), and a function
  `Replacement` receives the lower-cased name. A `{ segments }` matcher is case-insensitive either
  way.
- **A `Headers` result stores any value it rejects as `"[REDACTED]"`.** A `Headers` value must be
  a byte string, so every truncated value (the `"…[truncated]"` suffix is not one) and any
  replacement outside Latin-1 is stored whole as `"[REDACTED]"` instead.
- The breadth marker of a `Headers` is stored under the name `...`, since a header name cannot hold
  `…`; records and pairs use `…`, made unique against the kept names.
- `maxBreadth` bounds the headers kept, and a record's list of values is bounded to `maxBreadth`
  elements as well.

### Known gaps in the default policy

`secretKeys` matches whole words, so the parameter names `apikey`, `sig` and `signature`, common in
signed URLs, are not matched. Compose them in:

```ts
import { composePolicies, redactUrl, secretKeys } from "@vipengele/ts-core-redaction";

const policy = composePolicies(secretKeys, {
  keys: [{ segments: "apikey" }, { segments: "sig" }, { segments: "signature" }],
});

redactUrl("https://example.com/f?apikey=k1&sig=s1&page=2", { policy });
// => "https://example.com/f?apikey=[REDACTED]&sig=[REDACTED]&page=2"
```

### Cost

The helpers are O(n) in the length of the input whatever `maxStringLength` is: the whole input is
read before the result is cut. A URL cut to `maxStringLength` is no longer a valid URL.

## Limits

```ts
interface RedactOptions {
  replacement?: Replacement;
  maxDepth?: number;
  maxBreadth?: number;
  maxStringLength?: number;
}
```

The walk is bounded by three limits, each on by default. A breach leaves a marker in the copy and
never throws.

| Option            | Default | Bounds                                                                                          |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `maxDepth`        | `6`     | Levels of nesting kept, the input itself counting as the first. Only containers count.          |
| `maxBreadth`      | `100`   | Fields per object, items per array, entries per `Map`, members per `Set`, own fields per `Error`. |
| `maxStringLength` | `8192`  | UTF-16 code units per string value, cut after detectors have scanned it. Keys are never cut.    |

The markers:

- `"[Truncated]"` replaces a container deeper than `maxDepth`.
- `"[Truncated: N more]"` follows the first `maxBreadth` entries of a container, `N` being the
  number left out. It is an extra item of an array or member of a `Set`, and an entry under the key
  `"…"` of an object or `Map`. When a kept key already holds `"…"`, the marker takes `"…#1"`, then
  `"…#2"`, and so on; a `Set` member already equal to the marker likewise makes the marker take a
  `#1`, `#2`, … suffix. An `Error`'s `name`, `message`, `stack` and `cause` are always kept; only the
  fields it adds count toward `maxBreadth`.
- `"…[truncated]"` is appended to a string cut to `maxStringLength`; the suffix is not counted.

A reference back to a container that is still being walked is `"[Circular]"`, checked ahead of the
depth limit, so a cycle at the depth limit reads `"[Circular]"`.

A limit only ever drops data, so two cases involve a matched key:

- A matched key gets its replacement even when its value is a container past the depth limit,
  because the key is matched before the value is walked.
- A container past `maxDepth` is never read, so none of the keys inside it are matched. A function
  `Replacement` is called fewer times than it would be without limits.

`Infinity` turns a limit off. With `maxDepth: Infinity`, a deep enough input can overflow the
stack. `NaN` silently disables the limit it is given, `maxBreadth` included. `maxBreadth` counts
whole entries, so it is floored and clamped at 0: `2.5` keeps 2, and `-1` keeps none. `maxDepth` and
`maxStringLength` are used as given.

Chaining `redact` into `toJsonSafe` (from `@vipengele/ts-core-common`) with both left at their
equal breadth defaults miscounts: the second step drops the first step's `"[Truncated: N more]"`
marker as an ordinary entry and appends its own. Bound in one step and pass `Infinity` in the
other.

```ts
redact(payload, policy, { maxBreadth: Infinity, maxDepth: Infinity, maxStringLength: Infinity });
```

## Cost model

Without detectors, work is linear in the bounded tree: the containers kept, the entries kept in
them and the characters kept in their strings. With detectors, work is no longer bounded by the
characters kept: every visited string is scanned in full, however long, before it is cut to
`maxStringLength`, so a huge string costs its whole length times the number of detectors. A
reference shared between branches, without being a cycle, is walked once per path that reaches it,
so an adversarially shared acyclic graph costs up to about 100^6 = 10^12 node visits at the
defaults. Lower `maxBreadth` or `maxDepth` for input that is not
trusted to be a tree.

`pseudonymize` computes one synchronous, pure-JavaScript HMAC-SHA-256 per matched value, linear in
the value's length; `maskKeepLast` is a slice.

The output of a function `Replacement` is neither walked nor bounded. With `maxDepth: Infinity`,
stack depth grows with the input's depth.

## Caveats

- **`redact` still returns `Headers`, `URL` and `URLSearchParams` as `{}`.** They keep their state
  in internal slots, not own enumerable keys, so the walk finds nothing to copy. Redact them with
  `redactHeaders`, `redactUrl` (on `url.href`) and `redactQueryString` (on `params.toString()`).
- **A policy's matchers are normalized once, on first use, and cached by policy object identity.**
  Mutating a policy's `keys`, `except` or `detectors` array after it has already been passed to `redact()` has
  no effect on later calls with that same policy object. Build a new `RedactionPolicy` object
  instead of mutating an existing one.
- **`tokenCount` matches `{ segments: "token" }`, so `secretKeys` redacts it.** Segment matching
  is by word, and `tokenCount` has the segments `token`, `count`. Use `except` to exempt such keys:
  `composePolicies(secretKeys, { keys: [], except: ["tokenCount"] })`.
- **`secretKeys` matches whole words, so plurals and run-together spellings are not covered.**
  `credentials`, `tokens`, `apikey`, `apiKeys` (`api`, `keys`), `accesstoken`, `sessionid` and
  `clientsecret` each have a segment that differs from the listed `credential`, `token`, `api key`,
  `session` and `secret`, so none of them is redacted; `accessToken` (`access`, `token`) is. List
  such keys explicitly:
  `composePolicies(secretKeys, { keys: [{ segments: "credentials" }, { segments: "apikey" }] })`.
- **`except` exempts from every rule in the policy, not only the rule beside it.** After
  `composePolicies`, an `except` matcher from any part exempts a key that any other part's `keys`
  matched.
- **`toJSON()` is not honored, and an own `toJSON` is dropped from a copy rather than carried
  over.** `redact()` walks a value's own enumerable properties directly; it never calls `toJSON()`
  first. `@vipengele/ts-core-observability`'s error normalization honors `toJSON()` (ADR-0007);
  redaction is a deliberate exception to that convention. A `toJSON` copied by reference would
  still close over the original, un-redacted instance, and `JSON.stringify` invokes it
  automatically — so it is never copied, even when the source value's own `toJSON` isn't matched
  by any key rule.
- **Regex key matchers are unanchored.** A `RegExp` or `{ pattern }` matcher is tested as a
  substring/pattern match against the key, not a full match: `/token/` matches a key like
  `"my_token_field"`, not only a key that equals `"token"` exactly. Anchor the pattern (`/^token$/`)
  if an exact match is required.
- **A `RedactionPolicy`'s regex matchers and detectors are a trust boundary, not sanitized input.**
  `matchKey()` tests each key matcher against a short key string, but a detector's `pattern` and
  `validate` run against string values, which are attacker-controlled data of any length. Neither is
  validated for catastrophic backtracking or cost, and detectors scan a string in full before it is
  cut. Build a policy from patterns and functions you wrote or reviewed, the same way you would
  trust any other code compiled into your program; do not construct one from a pattern string an
  untrusted caller supplied. A match `validate` rejects is rescanned from its next character, so a
  detector's pattern and `validate` run once per start position inside a rejected match, and bounding
  that cost is the caller's too. The built-in detectors cost time linear in the string's length.
- **`Map` key-matching only applies to string keys.** A `Map` entry whose key is not a string is
  never tested against the policy, and the key itself is carried into the output by reference,
  unredacted — its value is still walked and redacted recursively, but sensitive data held on an
  object used as a Map key reaches the output unchanged. Use string keys for any Map whose keys
  might carry sensitive data.
- **A class instance other than `Map`, `Set` or `Error` keeps only its own enumerable string
  keys.** Anything whose state lives elsewhere — a `RegExp`'s pattern, a boxed primitive's wrapped
  value — is returned by reference instead of being walked into an empty object; `RegExp` and
  boxed primitives are recognized this way, alongside `Date` and `ArrayBuffer`/its views. A custom
  class with genuinely private state (a `#field` or a `WeakMap`-backed value) loses that state in
  the copy, since only own enumerable string keys are read. `URL` and `Promise` are the deliberate
  exceptions: a `URL`'s userinfo and query string can carry credentials no key rule could name,
  and a `Promise` has no way to verify it is genuine without a side effect (attaching a handler to
  it), so both are walked instead of passed through and come back `{}`, same as any other class
  instance with no own enumerable keys.
- **Built-in types are recognized by an internal-slot check, not by `Symbol.toStringTag` or
  `instanceof`.** A plain object can set its own `Symbol.toStringTag` to `"Date"` or `"Map"`, or be
  built in another realm and fail `instanceof` despite being a genuine instance; `redact()` calls a
  method the built-in's own spec requires to check that internal slot before doing anything else,
  so neither an impostor's claimed tag nor a real instance's foreign origin changes how it is
  handled. `Error` is the one exception: it has no such method to call, but a class instance
  merely claiming to be one is still just walked like any other instance, so nothing is exposed or
  thrown by a false positive there either.
