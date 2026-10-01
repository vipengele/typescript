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

- `src/redact.ts` — the `redact` walk, the only entry point.
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
- Limit values are not validated: they are applied with `>` comparisons, so `NaN` disables a
  limit.
- The breadth marker key (`…`) is made unique against kept keys (`breadthMarkerKey`), and a `Set`
  marker against its kept members (`uniqueBreadthMarker`), so the marker never overwrites or
  merges into a real entry.
- Lengths are UTF-16 code units; the truncation suffix is not counted.
