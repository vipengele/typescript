---
name: mask-keep-count-must-avoid-slice-zero-and-nan
kind: gotcha
description: "A keep-count used as slice(-n) must be finite and non-zero-checked: slice(-0) and slice(-NaN) return the whole string, and limits.ts's Math.max(0, Math.floor(n)) lets NaN through."
anchors:
  - path: source/core/packages/redaction/src/mask.ts
    blob: 6848bdb179ee
  - path: source/core/packages/redaction/src/limits.ts
    blob: 5dc77b989134
confidence: verified
---

`"4242".slice(-0)` and `"4242".slice(-NaN)` both return `"4242"`, so a count of 0 or NaN used as
`slice(-count)` leaks the whole value. `Math.max(0, Math.floor(NaN))` is `NaN`, and `resolveLimits` in
`limits.ts` relies on that expression for `maxBreadth`, where NaN is deliberately a disabled limit;
copying it for a mask count would leak the secret.

`resolveKeep` (`mask.ts:31`) returns 0 for anything that is not a finite number, and `maskKeepLast`
takes the fully masked branch whenever `count === 0` before it slices (`mask.ts:56`).

Related: `redactHeaders` stores `"[REDACTED]"` when a `Headers` rejects a value outside Latin-1
(`headers.ts:20`, `:56`), so `maskKeepLast` defaults its mask char to ASCII `*` rather than a bullet.
