---
about: observability calls redaction only after its own value normalizer has already made the value JSON-safe
saw:
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - source/core/packages/redaction/src/index.ts
  - source/core/packages/observability/src/errors/index.ts
  - source/core/packages/observability/src/logger/index.ts
---

ADR-0007 ("Attributes are normalized once, when the record is created",
docs/adr/0007-the-log-record-and-error-event-data-model.md:106-117) states the normalizer coerces
`bigint`, `Map`, `Set`, `Date`, cycles, functions, symbols and nested errors, bounds depth/breadth/
string length, and only then does "Redaction runs at the same point, before any Sink" — i.e.
*after* normalization inside `@vipengele/ts-core-observability`.

So when `@vipengele/ts-core-redaction` is consumed by observability, the value it walks is already
a plain JSON-safe tree (string/number/boolean/null, plain objects, arrays) — no cycles, no Map/Set/
Date/typed-arrays/getters/symbol keys to worry about in that call path.

Those gotchas (cycles, Map/Set, Date, class instances, typed arrays, getters, symbol keys,
prototype-less objects) only matter for `@vipengele/ts-core-redaction` used **standalone** (its
README says "Usable on its own", `source/core/packages/redaction/README.md:3-5`), since nothing in
the repo normalizes input before handing it to redaction in that path.

As of this check (2026-09-26), both `source/core/packages/redaction/src/index.ts` and
`source/core/packages/observability/src/{errors,logger}/index.ts` are 1-line stubs (`export {};`) —
there is no existing deep-walk, plain-object-detection, or cycle-handling code anywhere in the repo
to reuse or match conventions with (checked via
`grep -rn "getPrototypeOf|isPlainObject|WeakSet|lastIndex" source/core/packages/{common,observability}/src` → 0 hits).
