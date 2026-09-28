---
about: the JSON-safe engine's binary-leaf check never gives a Proxy-wrapped typed array a descriptor, and a Proxy-wrapped ArrayBuffer always reads as "[Unreadable]"
saw:
  - source/core/packages/common/src/serialization/engine.ts
  - source/core/packages/common/src/serialization/to-json-safe.test.ts
---

`isBinary` in `serialization/engine.ts` matches `ArrayBuffer.isView(value) || value instanceof
ArrayBuffer || (SharedArrayBuffer present && value instanceof SharedArrayBuffer)`. The two halves
reach different Proxies:

- `ArrayBuffer.isView(new Proxy(new Uint8Array(4), {}))` is `false`, so a Proxy around a typed
  array skips the descriptor and is walked as a generic object.
- `new Proxy(new ArrayBuffer(8), {})` passes `instanceof ArrayBuffer`, but the `byteLength`
  accessor throws when its receiver is the Proxy rather than a real buffer, so `describeBinary`
  returns `"[Unreadable]"` even with no traps installed.

`describeBinary` reads `constructor`, its `name` and `byteLength` through `readProperty` with a
`null` fallback. The default fallback is the string `"[Unreadable]"`, which would satisfy a
`typeof === "string"` check on the name and produce a descriptor from a failed read.
