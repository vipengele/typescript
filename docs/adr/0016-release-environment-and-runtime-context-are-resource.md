# Release, environment and runtime context are Resource, and the Reporter gates on the environment

The Resource the root Scope holds (`0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md`)
has eleven reserved keys:

| Key | Set by | Vocabulary |
|---|---|---|
| `service.name` | the application | OpenTelemetry |
| `service.version` | the application | OpenTelemetry |
| `service.dist` | the application | vipengele extension |
| `deployment.environment.name` | the application | OpenTelemetry |
| `process.runtime.name` | detected | OpenTelemetry |
| `process.runtime.version` | detected | OpenTelemetry |
| `os.type` | detected | OpenTelemetry |
| `os.version` | detected | OpenTelemetry |
| `browser.name` | detected | vipengele extension |
| `browser.version` | detected | vipengele extension |
| `device.type` | detected | vipengele extension |

A release is `service.version`, an environment is `deployment.environment.name`, and a build
distinguisher within one release (a Sentry `dist`) is `service.dist`, kept under the `service.`
namespace beside the version it qualifies. None of them is a `ReporterBuilder` option: an
application sets them once with `Scope.setResource`, and the logger and every Reporter read the same
values. Every key is reserved whether or not it holds a value, so no descendant scope may set one.

## Runtime context is detected by `createReporter`, into unset keys only

Creating a Reporter detects the runtime, operating system, browser and device once, through an
internal `detectRuntimeContext` in `@vipengele/ts-core-observability`'s `./errors` entry point, and
writes each detected key with `Scope.setResource` only when the Resource holds no value for it. A
value the application sets through `Scope.setResource` therefore wins whether it is set before the
Reporter is created (the key already holds a value) or after (it overwrites the detected value), and a
second Reporter fills only the keys still unset when it is created. A throw anywhere in detection,
or in reading or writing the Resource, leaves the Resource as it was and the Reporter working: a
Reporter is worth more than its detected runtime context. An application that uses only the logger
creates no Reporter and gets no detected values.

Detection is synchronous, dependency-free and best-effort:

- In Node, Bun, Deno and an edge runtime, `process.runtime.version` is the runtime's own version
  without a leading `v` — `Bun.version` and `Deno.version.deno`, since their `process.version` names
  the Node release they imitate — and `os.type` is `process.platform` in OpenTelemetry's lowercase
  vocabulary (`win32` is `windows`, `sunos` is `solaris`). `os.version` is never set there, since the
  OS release is only readable through `node:os`.
- In a browser or a worker, `process` is never read, since a bundler's polyfill is all it can be.
  The browser, OS and device keys come from `navigator.userAgent`, with the synchronous
  `navigator.userAgentData` hints outranking the string where present. `os.type` is `windows`,
  `darwin`, `linux`, `ios`, `android` or `chromeos`; `device.type` is `mobile`, `tablet` or
  `desktop`.
- What a user agent cannot tell is not guessed at. Chromium freezes the OS version it reports
  (macOS is always `10.15.7`, Windows 10 and 11 are both `10`), iPadOS sends a Mac user agent, and
  "Request Desktop Site" sends a desktop one, so those values are as accurate as the string is.

The detector is not exported and has no opt-out. A value an application knows better is set with
`Scope.setResource`, which always wins.

## The Resource is read once per event, at capture

The pipeline reads `Scope.resource()` once per event, at the head of capture and before any stage
runs, and hands that same frozen Resource to `transport.send(event, resource)`
(`0010-the-transport-contract-is-fire-and-forget.md`). A `Scope.setResource` made while an event
passes through the stages — from a processor, say — cannot relabel it: the environment an event was
gated on is the one it is sent with. A throwing read yields a Resource with every key `undefined`,
and the event still goes out.

## `ReporterBuilder#enabledEnvironments` gates on `deployment.environment.name`

`enabledEnvironments(list)` is an allow-list checked first, against the Resource read at capture:
an event whose `deployment.environment.name` the list does not hold is dropped before it is
normalized, and the capture still returns its id. An unset environment is enabled, and so is a
Resource whose read threw — a Resource that cannot be read says nothing about the environment. The
empty string is a set environment, enabled only when the list holds it. An empty list, a value that
is not an array, or a non-string entry throws `ReporterConfigError` and leaves the builder as it was:
an empty list here is a mistake, not a way to report nowhere, unlike Bugsnag's
`enabledReleaseStages`. An application that wants no reports creates no transport.

The gate drops the report, never the exit. Under the `globalHandlers` integration's `exit` policy
(`0012-global-handlers-are-an-integration-with-a-required-exit-policy.md`) an uncaught error in a
disabled environment is still printed, the transport still flushed, and the process still exits
with code 1.

## Considered options

- **`release()` and `environment()` builder options that call `Scope.setResource`.** A per-Reporter
  builder would mutate realm-wide state: two Reporters built with different values overwrite each
  other, and the logger reports whichever was built last.
- **Runtime context as event attributes.** It is the Resource merged into every record's attributes
  that `0007-the-log-record-and-error-event-data-model.md` already rejects — identical keys repeated
  on every event, who is emitting mixed with what happened — and it would split `process.runtime.*`
  across two carriers, the name on the Resource and the version on the event.
- **Detecting in the scope root, or in `@vipengele/ts-core-common/runtime`.** The root would have
  to parse user agents, coupling `./scope` — and every consumer of it, the logger included — to
  detection only the Reporter needs.
- **A Resource per Reporter instead of filling unset keys.** Each Reporter would carry its own copy,
  diverging from what the logger and other Reporters read, and an application's `Scope.setResource`
  after construction would not reach it.
- **A public detector export or an opt-out switch.** Neither is needed: an explicit
  `Scope.setResource` already wins over every detected key, and the detector's output is the
  Resource itself, readable through `Scope.resource()`.
