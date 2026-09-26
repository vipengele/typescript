# @vipengele/ts-core-redaction

Removes secrets and personal data from structured values before they are logged, reported or
sent anywhere: rules match keys and value patterns, and depth and size limits bound what is
walked. Usable on its own, and the redaction layer of `@vipengele/ts-core-observability`.

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
`Map`s, `Set`s, `Error`s and other class instances come back as copies; `Date`s, `ArrayBuffer`s and
their views, functions and primitives are returned as-is. The input is never mutated.

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
  never tested against the policy — its value is still walked and redacted recursively, but the
  key itself can never trigger a whole-value replacement.
