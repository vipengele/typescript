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
`Map`s, `Set`s, `Error`s and other class instances come back as copies; `Date`s, `RegExp`s, `URL`s,
`Promise`s, boxed primitives, `ArrayBuffer`s and their views, functions and primitives are returned
as-is. The input is never mutated.

`RedactOptions.replacement` controls what a matched value is replaced with; see `Replacement`
below. It defaults to the string `"[REDACTED]"`.

## `RedactionPolicy` and `KeyMatcher`

```ts
interface RedactionPolicy {
  keys: readonly KeyMatcher[];
}

type KeyMatcher = string | RegExp | { pattern: string | RegExp; caseInsensitive?: boolean };
```

A policy is a list of `KeyMatcher`s, each naming keys whose values are sensitive. A key matches if
any matcher in the list matches:

- A bare `string` matches a key exactly and case-sensitively.
- A bare `RegExp` is tested against the key with its own flags.
- The object form, `{ pattern, caseInsensitive? }`, wraps either a string or a `RegExp` pattern and
  adds `caseInsensitive`, which case-insensitively matches the string or applies the `i` flag to
  the pattern.

```ts
const policy: RedactionPolicy = {
  keys: ["password", /token/, { pattern: "email", caseInsensitive: true }],
};
```

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
  Mutating a policy's `keys` array after it has already been passed to `redact()` has no effect on
  later calls with that same policy object. Build a new `RedactionPolicy` object instead of
  mutating an existing one.
- **`toJSON()` is not honored.** `redact()` walks a value's own enumerable properties directly; it
  never calls `toJSON()` first. `@vipengele/ts-core-observability`'s error normalization honors
  `toJSON()` (ADR-0007); redaction is a deliberate exception to that convention.
- **Regex key matchers are unanchored.** A `RegExp` or `{ pattern }` matcher is tested as a
  substring/pattern match against the key, not a full match: `/token/` matches a key like
  `"my_token_field"`, not only a key that equals `"token"` exactly. Anchor the pattern (`/^token$/`)
  if an exact match is required.
- **`Map` key-matching only applies to string keys.** A `Map` entry whose key is not a string is
  never tested against the policy, and the key itself is carried into the output by reference,
  unredacted — its value is still walked and redacted recursively, but sensitive data held on an
  object used as a Map key reaches the output unchanged. Use string keys for any Map whose keys
  might carry sensitive data.
- **A class instance other than `Map`, `Set` or `Error` keeps only its own enumerable string
  keys.** Anything whose state lives elsewhere — a `RegExp`'s pattern, a boxed primitive's wrapped
  value, a `Promise`'s resolution — is returned by reference instead of being walked into an empty
  object; `RegExp`, `URL`, `Promise` and boxed primitives are recognized this way, alongside `Date`
  and `ArrayBuffer`/its views. A custom class with genuinely private state (a `#field` or a
  `WeakMap`-backed value) loses that state in the copy, since only own enumerable string keys are
  read.
