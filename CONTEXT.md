# Vipengele TypeScript

The TypeScript framework of the vipengele platform: runtime-agnostic libraries for the browser and
Node, released together at one version.

## Language

**Project**:
A self-contained pnpm workspace under `source/<project>/`. Every project is released on every tag
`vX.Y.Z`, at that version, after the projects it depends on (ADR-0001). `core` is the first.
_Avoid_: package (a project holds several), module, repo

**Package**:
One published npm package inside a project, named `@vipengele/ts-<project>-<name>`.
_Avoid_: library (ambiguous between package and project)

**Runtime**:
An environment a package must work in unchanged. The first-class runtimes are the browser
(exercised in Chromium) and Node 24+; every suite runs in both unless it is named
`*.node.test.ts` or `*.browser.test.ts`.
_Avoid_: platform (vipengele is the platform), environment (that is `production`, `staging`, …)

**Redaction**:
Removing or masking secrets and personal data from a structured value before it leaves the
process. Owned by `@vipengele/ts-core-redaction`.
_Avoid_: scrubbing, sanitizing (sanitizing also means escaping for output)

**Logger**:
A handle bound to one Category that emits Log Records. Obtained from
`@vipengele/ts-core-observability/logger`.

**Logger Provider**:
The level configuration and Sinks a set of Loggers share. The process has one default provider,
shared by every copy of the package loaded into it; an isolated provider serves tests and hosts
that keep tenants apart.
_Avoid_: logging platform (vipengele is the platform), logger factory, settings

**Category**:
A dotted name (`services.editing`) identifying where a record comes from. Levels are configured per
category prefix, and the longest matching prefix wins.

**Log Record**:
One structured log entry: timestamp, level, category, message, attributes and optionally an error.
_Avoid_: line, log line (a record is not text until a formatter makes it so)

**Sink**:
Where Log Records go: the console, a stream, a buffer, an exporter. A logger configuration may
hold several.

**Reporter**:
The error reporter from `@vipengele/ts-core-observability/errors`: captures errors, normalizes
them into Error Events and hands them to a Transport.

**Error Event**:
One captured error after normalization and enrichment: the exception chain with parsed stack
frames, its mechanism (handled or unhandled, and what caught it), its scope's context and its
breadcrumbs.
_Avoid_: exception (that is one link of the chain), issue (a grouping on the backend)

**Scope**:
The ambient context a Log Record and an Error Event are both enriched from, carried along an async
call chain. Scopes form a tree: the root holds the environment and never changes; every other
scope holds its own attributes and sees its ancestors', the innermost value winning, except that no
scope may `set` a key the root already holds. A scope created to begin a Unit of Work is a child of
the root, not of whatever scope was current; every other new scope is a child of the current one.
Either kind may carry a tag, its own Breadcrumb.
_Avoid_: context (OpenTelemetry's word for its own propagation object), MDC, request context (the
browser has no request)

**Carrier**:
What actually threads a value across an async call chain on one runtime: `AsyncLocalStorage` on
Node, a native `AsyncContext.Variable`, or a synchronous stack as the universal fallback, tried in
that fixed order (ADR-0004). An application may install its own ahead of the detected one
(`useCarrier`). Scope is carried by one; the value it carries is the Scope tree, not the carrier
itself.
_Avoid_: context (see Scope's own _Avoid_ — the same OpenTelemetry collision applies here)

**Resource**:
The root Scope seen from outside the process: which service, release, environment and runtime is
emitting. Sent once alongside Log Records and Error Events, never repeated inside each one.
_Avoid_: global tags, global context

**Unit of Work**:
One request, job or message handled end to end — the span of work whose Breadcrumbs belong
together. In the browser the page is the only unit of work.

**Breadcrumb**:
The tag a scope was created with — a short label for the step it represents (a request's path, a
click, a query). There is no separate record and no buffer: an Error Event's breadcrumb trail is
the tagged ancestors of the Scope it was raised in, walked from the root down. Recording a
breadcrumb for something is creating a scope for it.

**Transport**:
What delivers Error Events (and exported Log Records) out of the process: console, HTTP JSON, OTLP.
Owns batching, retry, `flush()` and `close()`.
_Avoid_: exporter (OTel's word; use it only for OTLP specifically)
