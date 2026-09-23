# Custom errors carry a `code` and a type-guard, not a class identity check

Every custom error the framework raises extends `VipengeleError`, an abstract base
(`abstract class VipengeleError extends Error { abstract readonly code: string }`) that does
nothing but require a `readonly code: string`. A concrete error — `NumericParseError` is the
first — sets `code` to a fixed string and ships alongside a paired type-guard function, such as
`isNumericParseError`, as the one sanctioned way for a caller to check for it.

## Why not `instanceof SpecificError`

A consumer's dependency tree can resolve two copies of the same package — differing peer ranges
across its own dependencies are enough to cause this even without a version bump anyone chose —
and each copy defines its own `NumericParseError` class. The two classes are structurally
identical and raised by the same source, but `instanceof` is an identity check on the constructor
function, and the two copies are two different functions. Code that catches an error raised by one
copy and tests it with `instanceof` from the other copy gets `false`. A `code` string carries none
of this: it is a value comparison, and the value is the same regardless of which copy produced it.

## Why the guard checks `instanceof Error`, not `instanceof VipengeleError`

`isNumericParseError` is `value instanceof Error && value.code === NUMERIC_PARSE_ERROR_CODE`, and
both halves matter. `instanceof Error` only needs to rule out values that are not errors at all —
so that a plain object with a matching `code` doesn't pass — and `Error` is the one class in this
check that is safe to test by identity, because it is a realm intrinsic rather than something this
framework or its consumer defines. `instanceof VipengeleError` or `instanceof
NumericParseError` would reintroduce the exact cross-copy problem the `code` check exists to
avoid: whichever copy of `common` is loaded, its `VipengeleError` is a distinct class from the one
on the error being tested. The guard's `instanceof` half stays anchored to something no package
resolution can duplicate.

## Considered options

- **Bare `instanceof SpecificError`.** The obvious approach, and the one that breaks under dual
  package resolution — the exact failure mode above.
- **A discriminated union without a base class.** Each error module could export its own `code`
  constant and type-guard with no shared abstract class. Works structurally, but nothing enforces
  that a new error remembers to add a `code` at all, and there is no single place that documents
  the pattern.
- **`Error.cause` or a bare property, no formal base class.** Puts a `code`-like value on the
  error but with no contract requiring it, so each error module reinvents the field name and the
  guard shape independently.

## Consequences

Every future custom error `common` — or any `@vipengele/*` package — raises needs a `code`, which
is a small, fixed cost paid once per error class. Consumers reach for the exported type-guard
instead of `instanceof` against the concrete class; documentation and examples should lead with
the guard, not the class name. `instanceof Error && code-check` is now the copy-paste template for
every new guard: the `instanceof Error` half stays exactly that, never narrowed to a
framework-defined class, however tempting that narrowing looks.
