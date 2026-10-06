---
about: a keep-count passed to slice(-n) must be finite and floored; resolveLimits' Math.max(0, Math.floor(n)) lets NaN through and slice(-0) returns the whole string
saw:
  - source/core/packages/redaction/src/mask.ts
  - source/core/packages/redaction/src/limits.ts
  - source/core/packages/redaction/src/mask.test.ts
---
- `"4242".slice(-0)` and `"4242".slice(-NaN)` both return `"4242"`, so a count of 0 or NaN used as `slice(-count)` leaks the whole value instead of hiding it. `Math.max(0, Math.floor(NaN))` is `NaN`, and `limits.ts` `resolveLimits` uses exactly that expression for `maxBreadth`, where a NaN is deliberately a disabled limit — copying it for a mask count would leak the secret.
- `mask.ts` `resolveKeep` returns 0 for anything that is not a finite number and `maskKeepLast` takes the fully-masked branch whenever `count === 0` before it slices. mask.test.ts covers 0, -1, NaN, Infinity and 1.5.
