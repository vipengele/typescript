# One Scope tree, shared by the logger and the reporter

A Log Record and an Error Event raised in the same Unit of Work carry the same context because both
read it from one place: the current `Scope`, a class in `@vipengele/ts-core-common` modelled on
Java's MDC. Scopes form a tree.

- **The root** holds the environment — release, environment name, runtime — and never changes after
  it is initialized.
- **The default scope** is a permanent, mutable child of the root, current whenever nothing else
  is: outside any request on Node, and in the browser, where the page is the only Unit of Work.
  A single-page app's `setUser` after login lands here.
- **Every other scope** is created as a child, holds its own `Record` of attributes and is mutable
  through `set`. It reads a key by walking up its ancestors at read time, never by copying them when
  it is created, so a value set on a request's scope after a nested child exists still reaches the
  child. A `set` on a nested child changes only that child. The innermost value wins.
- **A scope that begins a Unit of Work** (`isolate: true`) also owns that unit's Breadcrumbs, a
  bounded buffer kept apart from its attributes, so one request's breadcrumbs never reach another
  request's error.

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

The current scope is carried by a Scope Carrier — `current()`, `run(scope, fn)`, `bind(fn)` — the
first of these that applies: one the application installs with `Scope.useCarrier(...)`;
`AsyncLocalStorage` on Node, Bun and Deno, reached through `getBuiltinModule` (ADR-0004); the TC39
`AsyncContext` when `globalThis` has it; otherwise a synchronous stack. An installed carrier lets an
application that already runs zone.js — an Angular app — carry scopes across `await` through its
zones; a zone carrier lives in its own entry point, uses the `Zone` global the application loaded,
and never imports or installs zone.js. Patching globals stays the application's choice, never a
side effect of importing the framework. The store lives on
`globalThis`, like the logger's level table (ADR-0005), because two copies of the package with two
stores cannot see each other's scopes.

The synchronous stack sees a scope from `Scope.run` until the first `await`, and the default scope
after it — never a sibling flow's scope. Losing context is recoverable; context from the wrong
Unit of Work is a defect that reads as correct data. Code that needs a scope across an `await` in
the browser captures it (`Scope.current()`, then `scope.run(...)`), binds callbacks
(`scope.bind(fn)`), or relies on `logger.with()`, which is lexical and survives everything.

## Entering a scope

- `Scope.run(scope, fn)` is the primitive, and correct in every runtime.
- `using _ = Scope.enter(scope)` restores the parent on dispose, for **synchronous** blocks. Inside
  an `async` function, `enter` changes the execution that still belongs to the caller until the
  first `await`, so the caller would continue inside the child — a sibling's scope. `enter`
  schedules a microtask that finds the scope still entered only when the block crossed an `await`
  (a synchronous block always disposes first); it then restores the parent and emits one `warn`
  pointing at `Scope.run`. This is also why the TC39 `AsyncContext` proposal has no `enter`.
- `@isolatedScope()` and `@scoped(attributes)` wrap a method in `Scope.run`, so they are correct for
  `async` methods too. They accept both standard and legacy (`experimentalDecorators`) decorator
  calls, told apart by argument shape. `Scope.isolated(fn)` does the same for free functions,
  which decorators cannot reach.

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
