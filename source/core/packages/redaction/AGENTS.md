# @vipengele/ts-core-redaction

The reusable redaction library: `redact(value, policy, options)` returns a copy of `value` with
sensitive keys and values replaced. Zero runtime dependencies, so nothing from
`@vipengele/ts-core-common` may be imported here; shared constants are repeated instead.

## Commands (run from `source/core`)

```bash
pnpm build          # turbo run build
pnpm type-check
pnpm test           # vitest under Node and Chromium, 100% v8 coverage
pnpm lint
pnpm format:check
```

## Layout

- `src/index.ts` — the package root, the only entry point; it re-exports from the modules below.
- `src/redact.ts` — the `redact` walk.
- `src/url.ts`, `src/query-string.ts`, `src/headers.ts` — `redactUrl`, `redactQueryString` and
  `redactHeaders`, which redact strings and header lists textually. `redactParams`,
  `resolveStringOptions` and `ResolvedStringOptions` are internal to them and not exported from
  the root.
- `src/limits.ts` — the bounds on a walk and the markers a breach leaves behind.
- `README.md` — public docs, including the Limits and Cost model sections; keep them in step
  with `limits.ts` defaults.

## Limits

- `redact` bounds every walk with `maxDepth` (6), `maxBreadth` (100) and `maxStringLength`
  (8192), on by default. `Infinity` opts a limit out.
- A breach leaves a marker (`[Truncated]`, `[Truncated: N more]`, a `…[truncated]` string
  suffix) and never throws.
- The defaults deliberately match `toJsonSafe` in `@vipengele/ts-core-common`, so a value
  bounded by either reads the same. Change them in both places or in neither.
- Limits are applied with `>` comparisons, so `NaN` disables a limit and `Infinity` opts out.
  `resolveLimits` floors `maxBreadth` and clamps it at 0, so every kept count and marker count is
  exact; `maxDepth` and `maxStringLength` are used as given.
- The breadth marker key (`…`) is made unique against kept keys (`breadthMarkerKey`), and a `Set`
  marker against its kept members (`uniqueBreadthMarker`), so the marker never overwrites or
  merges into a real entry.
- `redactUrl`, `redactQueryString` and `redactHeaders` take `maxBreadth` and `maxStringLength`
  (no `maxDepth`; strings have none) and get their defaults from `limits.ts` alone, through
  `resolveLimits` and `truncateString`, so they share the `toJsonSafe` defaults. They define none of
  their own.
- `maxBreadth` counts parameters in `redactQueryString`, query and fragment parameters separately
  in `redactUrl`, and headers in `redactHeaders` (`Headers` entries, record names, pairs); a record's list of
  values is bounded to `maxBreadth` elements as well. `maxStringLength` cuts the whole redacted URL or query string, or
  each header value; redaction runs before truncation.
- Lengths are UTF-16 code units; the truncation suffix is not counted.
