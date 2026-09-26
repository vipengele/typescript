# One Scope tree, shared by the logger and the reporter

A Log Record and an Error Event raised in the same Unit of Work carry the same context because both
read it from one place: the current `Scope`, a class in `@vipengele/ts-core-common` modelled on
Java's MDC. Scopes form a tree.

- **The root** holds the environment — release, environment name, runtime — and never changes after
  it is initialized. No other scope may `set` a key the root already holds; the root's keys are
  reserved, never shadowed, so reading one never has to prefer the root over a closer scope that
  was never allowed to hold it in the first place.
- **The default scope** is a permanent, mutable child of the root, current whenever nothing else
  is: outside any request on Node, and in the browser, where the page is the only Unit of Work.
  A single-page app's `setUser` after login lands here.
- **Every other scope** is created as a child, holds its own `Record` of attributes and is mutable
  through `set`. It reads a key by walking up its ancestors at read time, never by copying them when
  it is created, so a value set on a request's scope after a nested child exists still reaches the
  child. A `set` on a nested child changes only that child. The innermost value wins, except for a
  root-owned key, which no descendant may set to begin with.
- **A scope that begins a Unit of Work** (`Scope.isolated`) is a child of the root, not of whatever
  scope was current — so one request's tree never hangs off another's — and, like any scope, may
  carry a tag. A scope created mid-request (`Scope.inherit`) is a child of the current scope instead,
  and may carry its own tag for the step it represents.
- **There is no separate Breadcrumb buffer.** A scope's tag *is* its Breadcrumb. An Error Event's
  trail is the tagged ancestors of the Scope it was raised in, read by walking from the root down —
  recording a breadcrumb for something is creating a scope for it (`Scope.inherit` or
  `Scope.isolated` with a tag), never a separate call.

Mutability is what Sentry's isolation layer exists for: authentication middleware identifies the
user after the request has started, and an error three calls later must still carry it. In a tree
this is a `set` on the request's scope, without Sentry's three differently-behaving layers.

## A Logger's own bindings sit between the Scope and the call

`logger.with(attributes)` returns a Logger with lexically bound attributes: they follow the Logger
object, not the call chain, and never touch the Scope. A record's attributes merge from least to
most specific — the Scope chain from root to innermost, then the Logger's bindings, then the
call's — so the call site always wins. The reporter reads only the Scope; an error logged through
`log.error(...)` carries the Logger's bindings as record attributes.

## Propagation, and what the browser guarantees

The current scope is carried by a `ContextCarrier<Scope>` — `current()`, `run(scope, fn)` — installed
through `Scope.useCarrier(...)` ahead of whichever is detected: `AsyncLocalStorage` on Node, Bun and
Deno, reached through `getBuiltinModule` (ADR-0004); the TC39 `AsyncContext` when `globalThis` has
it; otherwise a synchronous stack. `Scope` owns exactly one such carrier, behind one fixed
`globalThis` key — there is no way to ask `Scope` for a second, independent store.
`Scope.propagate`, `Scope.inherit` and `Scope.isolated` are all built on this one carrier contract;
none of them need a carrier to know anything about capturing or rebinding a value for later, because
that is handled once, generically, by the underlying store's own single-argument `propagate` —
which is also why `ContextCarrier` needed no extra method for `Scope`'s sake: a zone.js carrier's
own native rebind (`Zone.current.wrap`) and the generic capture-then-`run` fallback produce the same
result, so there was never a case for the carrier itself to supply a different `bind`. An installed
carrier lets an application that already runs zone.js — an Angular app — carry scopes across
`await` through its zones; a zone carrier lives in its own entry point, uses the `Zone` global the
application loaded, and never imports or installs zone.js. Patching globals stays the application's
choice, never a side effect of importing the framework. The store lives on `globalThis`, like the
logger's level table (ADR-0005), because two copies of the package with two stores cannot see each
other's scopes.

The synchronous stack sees a scope for the duration of the callback passed to `Scope.propagate`,
`Scope.inherit` or `Scope.isolated`, and the default scope again once that callback's *synchronous*
frame returns — never a sibling flow's scope. Losing context is recoverable; context from the wrong
Unit of Work is a defect that reads as correct data. Code that needs a scope across an `await` in
the browser captures it (`Scope.current()`, then `Scope.propagate(scope, fn)` again after the gap),
or relies on `logger.with()`, which is lexical and survives everything.

## Creating a scope

- `Scope.inherit(tag, attributes, fn)` creates a child of the **current** scope, carrying `tag` as
  its Breadcrumb, and runs `fn` with it current — correct in every runtime, including across an
  `await` inside `fn` wherever the carrier supports it.
- `Scope.isolated(tag, attributes, fn)` does the same, but as a child of the **root** rather than of
  whatever was current — the entry point for a new Unit of Work, so one request's tree never hangs
  off another's.
- Both are callback-taking only. There is no disposable `enter()` and no bare `using` form: without
  a callback boundary, a sequence of scopes created in the same block nest instead of forming
  siblings (the first is still current, so the second's parent is the first, not the first's own
  parent) — confusing exactly where it matters most, several steps inside one method — so the
  callback form is the only one offered.
- Because every scope is entered through a callback, there is no execution that silently continues
  in the wrong scope after an unawaited gap the way a disposable-based `enter()` would have allowed.
  The crossed-`await` warning considered earlier is dropped along with `enter()` itself; the
  synchronous stack's documented limitation (loses the scope after the first `await` inside `fn`)
  stands on its own, without a warning.
- `@isolatedScope(tag)` and `@scoped(tag, attributes)` wrap a method body in `Scope.isolated`/
  `Scope.inherit`, so they are correct for `async` methods too. They accept both standard and legacy
  (`experimentalDecorators`) decorator calls, told apart by argument shape.

A `Scope`'s public surface is only `tag`, `get` and `set` — never `parent`. Walking the tree to read
a breadcrumb trail is the reporter's own internal concern, not something an application does, so
nothing about ancestry is exposed outside the framework's own code.

## Considered options

- **Sentry's global → isolation → current layers.** Equivalent in power, but three concepts with
  different mutability rules where one tree with one rule suffices.
- **One immutable context, as OpenTelemetry's.** Clean, but the middleware case above needs
  everything after the middleware wrapped, which many frameworks do not allow.
- **Two layers, global plus one mutable per-request layer.** A Logger's bindings would mutate the
  request for everything else in it.
- **Copying the parent's attributes into a child at creation.** A value set on the parent later
  never reaches children that already exist.
- **Zone.js-style patching** of `Promise`, timers and events by the framework itself. A global
  side effect on import, and it still loses the scope at every native `await`: the engine resumes
  an `async` function through its internal promise machinery, not the patched global `Promise`, so
  zones survive `await` only in builds that transpile `async`/`await` away. OpenTelemetry's
  `ZoneContextManager` carries the same requirement.
- **Carrying the Scope inside OpenTelemetry's `Context`** whenever `@opentelemetry/api` is present.
  With the API but no SDK the context manager is a no-op and every `Scope.run` silently does nothing,
  and the same code would behave differently depending on a dependency elsewhere in the
  application. The Scope and OpenTelemetry's context are independent: on Node both ride
  `AsyncLocalStorage` and follow the same chain; neither `Scope.run` nor `@isolatedScope` starts a
  span, and starting a span creates no scope.
