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

**Redaction Policy**:
What keys to redact and how: a set of Key Matchers and the Replacement applied where one matches.
Composable presets and exceptions are `@vipengele/ts-core-redaction`'s own concern to add on top,
not a separate glossary term.

**Key Matcher**:
One rule a Redaction Policy tests an object key against: an exact string, a regular expression, or
either compared case-insensitively.

**Replacement**:
What a matched Key Matcher's value becomes: `"[REDACTED]"` by default, or a caller-supplied
function of the matched value and key, so partial masking and pseudonymization are additional
Replacements, not a different mechanism.

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
scope holds its own attributes and sees its ancestors', the innermost value winning. A scope that
begins a Unit of Work also owns that unit's Breadcrumbs.
_Avoid_: context (OpenTelemetry's word for its own propagation object), MDC, request context (the
browser has no request)

**Resource**:
The root Scope seen from outside the process: which service, release, environment and runtime is
emitting. Sent once alongside Log Records and Error Events, never repeated inside each one.
_Avoid_: global tags, global context

**Unit of Work**:
One request, job or message handled end to end — the span of work whose Breadcrumbs belong
together. In the browser the page is the only unit of work.

**Breadcrumb**:
A small record of something that happened before an error (a log record, a request, a navigation,
a click), kept in a bounded buffer and attached to the next Error Event.

**Transport**:
What delivers Error Events (and exported Log Records) out of the process: console, HTTP JSON, OTLP.
Owns batching, retry, `flush()` and `close()`.
_Avoid_: exporter (OTel's word; use it only for OTLP specifically)
