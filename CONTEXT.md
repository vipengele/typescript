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
The context an Error Event is enriched from — tags, user, attributes, breadcrumbs. Scopes nest,
and the innermost wins.

**Breadcrumb**:
A small record of something that happened before an error (a log record, a request, a navigation,
a click), kept in a bounded buffer and attached to the next Error Event.

**Transport**:
What delivers Error Events (and exported Log Records) out of the process: console, HTTP JSON, OTLP.
Owns batching, retry, `flush()` and `close()`.
_Avoid_: exporter (OTel's word; use it only for OTLP specifically)
