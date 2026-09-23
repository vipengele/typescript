---
description: Every custom error extends VipengeleError and ships a code plus a type-guard; callers never use instanceof against the concrete class.
---

# Custom errors carry a `code` and a type-guard, not a class identity check

Every custom error the framework raises extends `VipengeleError`
(`source/core/packages/common/src/errors/vipengele-error.ts`), an abstract base requiring a
`readonly code: string`. A concrete error sets `code` to a fixed string and ships alongside a
paired type-guard (`isNumericParseError` for `NumericParseError`) as the one sanctioned way for a
caller to check for it. See ADR-0002 for the rationale.

## Applies to

Any new error class in `@vipengele/ts-core-common` or another `@vipengele/*` package.

## Example

```ts
// ✗ catch (e) { if (e instanceof NumericParseError) ... }
// breaks under dual package resolution: two resolved copies of the same package give the
// same source two distinct class identities.

// ✓ catch (e) { if (isNumericParseError(e)) ... }
export function isNumericParseError(value: unknown): value is NumericParseError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === NUMERIC_PARSE_ERROR_CODE;
}
```

The guard's `instanceof` half stays anchored to `Error`, never narrowed to `VipengeleError` or the
concrete class — narrowing it reintroduces the exact cross-copy problem the `code` check exists to
avoid.
