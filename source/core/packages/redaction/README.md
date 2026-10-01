# @vipengele/ts-core-redaction

Removes secrets and personal data from structured values before they are logged, reported or sent
anywhere, by matching keys against a policy — value-pattern matching and depth/size limits are
outside this package's scope. Usable on its own, and the redaction layer of
`@vipengele/ts-core-observability`.

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
whole and never descended into; everything else is walked recursively. Plain objects, arrays,
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

Returns a new frozen policy whose `keys` are every part's `keys` and whose `except` is every
part's `except`, each in order. The parts are never mutated. `except` is policy-wide after
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

## `Replacement`

```ts
type Replacement = string | ((value: unknown, key: string) => unknown);
```

What a matched value is replaced with, either:

- a fixed `string`, used as-is for every match, or
- a function, called for every matched value with `(value, key)`, whose return value replaces it.

There is no third mode where a function is called once to produce a single, shared replacement —
a function `Replacement` runs per match, every time.

```ts
redact(payload, policy, { replacement: (value, key) => `[REDACTED:${key}]` });
```

## Caveats

- **A policy's matchers are normalized once, on first use, and cached by policy object identity.**
  Mutating a policy's `keys` or `except` array after it has already been passed to `redact()` has
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
- **A `RedactionPolicy`'s regex matchers are a trust boundary, not sanitized input.** `matchKey()`
  tests each one against a short key string, never against attacker-controlled data — but the
  pattern itself is never validated for catastrophic backtracking. Build a policy from patterns
  you wrote or reviewed, the same way you would trust any other regular expression compiled into
  your program; do not construct one from a pattern string an untrusted caller supplied.
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
