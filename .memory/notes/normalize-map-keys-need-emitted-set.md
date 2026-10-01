---
name: normalize-map-keys-need-emitted-set
kind: dead-end
description: "Disambiguating colliding Map keys needs a Set of already-emitted output keys; a per-base-key repeat counter still collides with literal keys like \"dup#1\"."
anchors:
  - path: source/core/packages/common/src/serialization/engine.ts
    blob: d684c98b6650
confidence: verified
---

`normalizeMap` (`engine.ts:156`) stringifies keys because `Object.fromEntries(map)` collapses
distinct object keys to `"[object Object]"`. The first fix appended `#<n>` from a counter per base
key, which still collides when a literal key already looks generated (`{toString: () => "dup"}`,
then `"dup#1"`, then another `"dup"`-stringifying key). The fix raises the suffix until the
candidate is absent from `emitted` (`engine.ts:158,172-175`); `breadthMarkerKey` (`engine.ts:72`)
does the same for the truncation marker. Do not revert to a counter.
