# Logging is configured through a shared default provider and a builder

A Logger is obtained from `Logging`, a static class (the same shape as `Numeric`), and reads its
Logger Provider's configuration on every write — never a copy taken when the Logger was created.
Configuration is composed with a builder that starts from the defaults, and applied atomically:

```ts
import { Logging } from '@vipengele/ts/logger';

const log = Logging.logger('services.editing');          // module scope, costs nothing

Logging.configure(b => b                                  // an application, never a library
  .clearDefaults()
  .addLevels({ services: 'debug' })
  .addBrowserSources()                                    // ?log= and localStorage
  .addFromFile('https://…/logging.json')                  // fetched; applied when it arrives
  .add(OtelLogging.bridge({ provider }))                  // optional pieces are objects
  .addSink(new ConsoleSink()));

Logging.override('services.editing', 'trace');           // live, on top of the build
Logging.override('services.editing', null);               // removes that override
Logging.reset();                                          // drops overrides, rebuilds defaults

const provider = Logging.createProvider(b => b.addLevels({ '*': 'trace' }).addSink(testSink));
```

## One default provider per process, plus isolated providers

`Logging`'s static methods act on a default `LoggerProvider` kept on `globalThis`, because the
package is routinely loaded more than once — symlinked workspaces, a library that depends on
`@vipengele/ts-core-observability` directly next to an app on `@vipengele/ts` — and a table each
copy keeps for itself makes raising a level change a table nothing reads. `createProvider` returns
an isolated `LoggerProvider` with the same instance methods, for tests and for hosts that keep
tenants apart.

Only a registry, and every test shares global state and no host can run two tenants. Only explicit
providers, and every library has to be handed a provider before it can log, which removes the
module-scope `Logging.logger('x')` that makes a library's logging free to add.

## What two versions of the package share

The registry is split by how each part breaks across versions:

- **The level table** — category to level name — is one key for every version,
  `Symbol.for('vipengele.logger.levels')`. Its format is a public protocol that never changes
  incompatibly; a level name a copy does not know resolves to the nearest one it does, never to
  "everything on". This is the switch people flip, so it must reach every copy.
- **Sinks and provider state** are keyed by record-protocol version,
  `Symbol.for('vipengele.logger.provider.v1')`, bumped only when the Log Record's shape breaks.
  A Sink built for one shape is never handed another.
- Each copy registers its protocol version; a copy that finds another protocol already present
  emits one `warn` saying Sinks configured on one do not receive the other's records.

One key for everything hands old Sinks new records. One key per package major splits the level
table, so an application raising a level silently misses a library pinned to the other major.

## Quiet by default; the operator has the last word

The default level is `'*': 'warn'`: a library embedded in someone else's product must not bury
its host's output, but a warning about a misconfiguration the integrator does not know to look for
still gets through.

Precedence, lowest first: the defaults, the builder's sources in the order they were added, live
overrides, then `VPG_LOG` from the Node environment. `VPG_LOG` is read lazily on first level
resolution (not on import, which would break `"sideEffects": false`), is always applied last, and
survives `clearDefaults()` and `reset()`; only an explicit `.ignoreEnvironment()` removes it, so
an operator can raise a level in production without a deploy and no application can switch that
off by accident. Browser sources are opt-in: a library has no business reacting to its host page's
URL, and `localStorage` is shared by the whole origin. The live console switch is installed
explicitly (`Logging.installConsole(name)`) and confirms every change with a record of its own,
because a switch that does nothing looks exactly like a quiet application.

## How configuration changes

- `configure` rebuilds from the defaults every time and calls `build()` itself, validating
  everything before swapping it in: the new configuration applies whole or not at all.
- Sinks form a list the build replaces; functions have no meaningful merge.
- Changes made while running are overrides, a layer above the build: `override(category, level)`
  sets one, `override(category, null)` removes it and lets whatever is beneath show through.
- A source that has to be fetched keeps its place in the precedence order and applies when it
  resolves; `configure` stays synchronous because Loggers are used from module scope.
- `configure` and `override` return a snapshot of the configuration in force, layer by layer.
- A bad level in code throws a `LoggingConfigError` (ADR-0002). A bad entry in a spec string from
  the environment, the URL or storage is skipped with its own `warn`, so a partly wrong spec is
  never silently partial.

## Why optional pieces are objects, not builder methods

TypeScript has no extension methods. `builder.addOtel()` would make the core builder depend on
OpenTelemetry and ship it in every bundle, or make the OpenTelemetry entry point patch the builder's
prototype on import, a side effect `"sideEffects": false` forbids. Core capabilities are builder
methods; anything with a dependency or weight is an object passed to `add`, from its own entry
point.

## Considered options

- **Merge-on-call configuration** (`configure({ levels })` merged into one table). Removing one
  override has no defined result — nothing records what was beneath it — and the precedence of
  several sources is implicit in call order across the application.
- **Configuration copied into each Logger at creation**, as consola does. A level changed at
  runtime never reaches Loggers that already exist, including every module-scope one.
- **Reading every source automatically.** A library would react to its host page's `?log=`, and
  reading at import breaks `"sideEffects": false`.
