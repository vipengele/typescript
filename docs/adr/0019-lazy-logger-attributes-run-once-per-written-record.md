# Lazy logger attributes run once per written record and fail to an empty record

An emit method's `attributes` argument and `Logger#with` accept an `AttributesThunk`, `() =>
AttributesInput`, exported as a type from `@vipengele/ts-core-observability/logger`.

## Per-call thunks

`trace`, `debug` and `info` read their second argument, and `warn`, `error` and `fatal` their third,
as a thunk when `typeof` says it is a function. It runs after the level check and the no-sink early
return, once per record however many sinks receive it, before normalization and redaction. The merge
order stays Scope, then bindings, then the call.

In `warn`, `error` and `fatal` the `error` parameter stays `unknown`, so a function in that position
is an error value, serialized like any thrown value, never a thunk. This is the trade-off: a caller
who wants a thunk there passes `undefined` as the error. Dispatching on the error position would
make a thrown function impossible to log.

## Failure gives an empty record

A thunk that throws, or returns a string, array, `null`, `undefined`, number or function, yields
`{}` for its layer. The record is still written and nothing goes to `onSinkError`, which is for
sinks and processors.

A thunk that logs from inside itself, or reads a bound thunk, gets `{}` from a re-entrancy flag.
Without it a `RangeError` is caught at every frame and one call writes thousands of records. The
flag is a module-level variable, so it is global within one copy of the package: while any thunk
runs, any other thunk on any logger of that copy gets `{}`. It is not shared across resolved copies
of the package, so a thunk that recurses through a second copy is not stopped. The flag does not use
the `globalThis` slot pattern the shared-realm rule describes, because it guards one synchronous
call stack rather than state that must agree across copies; a recursion through two copies of the
package is not caught.

## `with(thunk)` is lazy and evaluated at most once per bound logger

A bound thunk runs at the first record that passes the level check and has a sink. The result is
normalized, deeply frozen and reused. A throw gives `{}` for that record and is not kept, so the next
record retries. A bound thunk is a lazy layer in an ordered list; static layers are fixed. Layers
merge in order, so `with(thunk).with({ x })` lets the static `x` win over the earlier thunk.

A Logger made by `with` carries an already evaluated parent value as a fixed value. If the parent is
unevaluated the child gets its own cell and evaluates at its own first record, so parent and child
can disagree. `with()` returns the same Logger only for an empty static input; any thunk makes a new
one.

The first record decides the value, so a thunk that reads ambient context such as the Scope captures
the context of that record for all later ones. The README points to Scope attributes for values that
follow each record.

## What "no allocation" means

A disabled call makes the Logger allocate nothing and run nothing: no thunk, clock, Scope read or
emit settings read. The level entry for a category with nothing configured is one shared frozen
entry. An arrow function written inline at a disabled call site is a closure the caller allocates,
which no Logger can avoid; `if (log.enabled("debug"))` is the guard that costs nothing.

## Proof

- `hot-path.test.ts`, in both runtimes: a disabled call, and a call with no sink, never runs the
  thunk, the clock, the Scope or the emit settings.
- `hot-path.node.test.ts`, in Node only: one hoisted thunk, 2e4 warm-up calls, then 1e5 disabled
  `debug` calls, with heap growth under 256 KB. A garbage collection can free what the loop
  allocated and hide it, so the test observes collections through `PerformanceObserver` and
  discards any attempt during which one ran. It makes up to three attempts and needs one clean one.
  Tests cannot import `node:*` here, so `process` is reached through `globalThis`.

## Considered options

- **Dropping the record when a thunk throws.** The message is lost silently for a failure in
  optional detail.
- **A marker attribute on failure.** Invents a reserved key convention the repo does not have.
- **Reporting a thunk failure to `onSinkError`.** The callback is for sinks and processors.
- **Evaluating `with(thunk)` eagerly.** Pays for the thunk when no record is written, and runs
  before the configuration that decides whether any is.
- **A vitest bench.** `src/**` counts toward the 100% coverage gate and ships in the build output,
  and nothing in CI would run a bench outside `src`.

## Consequences

- A bound thunk that reads the Scope fixes its value at the first record.
- Parent and child loggers can hold different values from the same thunk.
- A function can never be a thunk in the `error` position.
