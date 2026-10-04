# Global handlers are an Integration with a required Exit Policy

A Reporter installs `Integration`s: objects added to its builder, set up when it is created and torn
down when it is closed.

```ts
interface Integration {
  readonly name: string;
  setup(host: IntegrationHost): (() => void) | void;
}

interface IntegrationHost {
  capture(error: unknown, context: { mechanism: Mechanism; level?: Level; attributes?: AttributesInput }): string;
  flush(timeoutMs?: number): Promise<boolean>;
}
```

The host is the capture pipeline and the transport's `flush`, nothing more, so the `Reporter`
interface gains no method for the benefit of integrations. `setup` returns its own teardown. A `setup`
or teardown that throws is contained: creating or closing a Reporter never throws because of one
integration. Teardowns run newest first, before `transport.close()`, and only once. Adding an
integration whose `name` is already on the builder replaces the earlier one, as `transport` and
`clock` do; this is optional pieces being objects passed to `add` (ADR-0005).

`globalHandlers` is the first integration. In the browser it listens for `error` and
`unhandledrejection` on `globalThis`; in Node, for `uncaughtException` and `unhandledRejection`. Both
Node listeners are always registered, because an unhandled rejection with no `unhandledRejection`
listener reaches `uncaughtException`.

## The Exit Policy has no default

`onUncaught` and `onUnhandledRejection` are each required, `"exit"` or `"continue"`. Attaching any
listener switches off Node's own crash report and exit, so the integration changes whether the
process survives an error the moment it is added. Whether that is right depends on the application:
a worker that can be restarted wants `"exit"`, a long-lived server that holds sessions may want
`"continue"` for rejections. A default would make that decision for every caller who did not read the
option, so the type system makes the caller write it. The browser never exits and ignores both.

## The reporter owns global state until `close()`

A Reporter with integrations holds more than its own fields: the listeners it installs belong to it until
`close()` removes them. Creating one with an integration has an effect on the process, so a test or a
library must close what it creates.

## The `"exit"` sequence

`"exit"` writes the error to `console.error`, awaits `flush(flushTimeoutMs)`, then calls
`process.exit(1)` whether or not the flush finished. The console write comes first because a
listener removes Node's own report, and a transport that does not write to the console would leave a
crash with no trace. The exit is unconditional because a flush that never resolves must not keep a
crashed process alive. `flushTimeoutMs` defaults to 2000 ms, the first timeout default in the repo:
long enough for a batching transport to send its last batch, short enough that a supervisor does not
kill the process first.

A second error with an `"exit"` policy while the flush is pending exits at once, since the process is
already known to be unhealthy and waiting again only widens the window. The first event may be lost.

## `"continue"`

The event is captured and the process keeps running. Node treats process state as undefined after an
uncaught exception, so `"continue"` is a choice to run on over possibly broken state; the README says
so.

## No realm-wide guard against a second install

State shared by every copy of a package lives behind a `globalThis` slot keyed by `Symbol.for`
(`agentic/rules/shared-realm-state-lives-behind-a-globalthis-symbol-slot.md`), and a memory
candidate argued that handlers need such a guard so two copies of the package never register twice.
`globalHandlers` has none. Two Reporters installing handlers is legitimate: each is its own
destination, and each should see every error. The one case worth preventing is the same Reporter
installing twice, and the builder prevents that by replacing an integration of the same name. What
bounds the listeners a Reporter leaves behind is teardown on `close()`, which removes exactly the
listeners that Reporter added. A guard would make the second Reporter silently capture nothing.

## Considered options

- **`uncaughtExceptionMonitor`.** It observes without taking over Node's crash behaviour, but its
  listener cannot await anything: the process exits as soon as it returns, so a flush cannot
  complete.
- **A default exit policy.** See above: it would decide the survival of every process that adds the
  integration without reading the option.
- **A `Symbol.for` guard so only one Reporter installs handlers.** See above.
- **A new public `Reporter` method for integrations to capture through.** The host hands an
  integration only what it needs, and the Reporter's surface stays what callers use.
