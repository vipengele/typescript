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
What to redact and how: a set of Key Matchers, optionally a set of exceptions (Key Matchers whose
keys are never redacted, even when a rule matches them), optionally a set of Detectors, and the
Replacement applied where a rule or a Detector matches. Composable presets are
`@vipengele/ts-core-redaction`'s own concern to add on top, not a separate glossary term: a preset
is a Redaction Policy.

**Key Matcher**:
One rule a Redaction Policy tests an object key against: an exact string, a regular expression,
either compared case-insensitively, or a word-segment match that finds whole words in a key
regardless of its casing or separators (`api key` matches `APIKey` and `x-api-key`, and `token`
matches `csrfToken` but not `tokenizer`).

**Detector**:
One rule a Redaction Policy tests the text of a string value against, however the value is keyed: a
pattern, optionally a check that confirms a candidate match. Only the span a Detector matches is
replaced; the rest of the string is kept. Built-in Detectors cover secrets and personal data that
have a recognizable shape, such as a JWT, a card number or an email address.
_Avoid_: scanner, pattern (a Detector may confirm a match as well as find one)

**Replacement**:
What a matched Key Matcher's value, or a Detector's matched span, becomes: `"[REDACTED]"` by
default, or a caller-supplied function of the matched value and key, so partial masking and
pseudonymization are additional Replacements, not a different mechanism.

**JSON-safe**:
Describes a value that survives `JSON.stringify` unchanged in meaning and is bounded in size: no
cycles, no `bigint`, `Map`, `Set`, function or symbol, and capped depth, breadth and string length.
Every value a Sink or Transport receives is JSON-safe. Owned by `@vipengele/ts-core-common`.
_Avoid_: serialized (that is a value already turned into text), sanitized

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
One structured log entry: time, level, category, message, attributes and optionally an error.
_Avoid_: line, log line (a record is not text until a formatter makes it so)

**Sink**:
Where Log Records go: the console, a stream, a buffer, an exporter. A logger configuration may
hold several.

**Reporter**:
The error reporter from `@vipengele/ts-core-observability/errors`: captures errors, normalizes
them into Error Events and hands them to a Transport.

**Error Event**:
One captured error after normalization and enrichment: the exception chain with parsed stack
frames, its mechanism (handled or unhandled, and what caught it) and its scope's attributes.
_Avoid_: exception (that is one link of the chain), issue (a grouping on the backend)

**Frame**:
One parsed entry of an Error Event's exception stack: a function, a file, a line and a column, each
present only when the engine reported it. Frames are ordered as the engine prints them, so the
first is the throw site.
_Avoid_: stack line (a frame is parsed, not text), call site

**In-app**:
Describes a Frame that is the application's own code, as opposed to a dependency, a runtime builtin
or a file the engine did not name. Which code counts as the application's is configured per Reporter
by its project root; with none set, every Frame that is not a dependency or a builtin is in-app.
_Avoid_: first-party, user code

**Runtime identity**:
The family `detectRuntime` from `@vipengele/ts-core-common/runtime` reports code is executing in:
`browser`, `worker`, `node`, `deno`, `bun`, `edge` or `unknown`. Wider than the two tested
Runtimes — Node and Chromium — which are the only ones every suite runs in; the rest are detected
and branched on, not exercised.
_Avoid_: platform, environment

**Scope**:
The ambient context a Log Record and an Error Event are both enriched from, carried along an async
call chain. Scopes form a tree: the root holds the environment and never changes except through
`Scope.setResource`; every other scope holds its own attributes and sees its ancestors', the
innermost value winning, except that no scope may `set` a key the root already holds. A scope
created to begin a Unit of Work is a child of the root, not of whatever scope was current; every
other scope is a child of the current one.
Either kind may carry a tag, its own Breadcrumb.
`Scope.setUser`, `Scope.setTag` and `Scope.setContext` write attributes to the current scope.
_Avoid_: context as a name for the Scope tree (OpenTelemetry's word for its own propagation
object), MDC-style ambient data, request context (the browser has no request). `setContext` is the
one sanctioned use: the verb that writes a namespaced group of attributes, `name.field` keys.

**Carrier**:
What actually threads a value across an async call chain on one runtime: `AsyncLocalStorage` on
Node, a native `AsyncContext.Variable`, or a synchronous stack as the universal fallback, tried in
that fixed order (ADR-0004). An application may install its own ahead of the detected one
(`useCarrier`). Scope is carried by one; the value it carries is the Scope tree, not the carrier
itself.
_Avoid_: context (see Scope's own _Avoid_ — the same OpenTelemetry collision applies here)

**Resource**:
The root Scope seen from outside the process: which service, release, environment and runtime is
emitting. Set through `Scope.setResource`, and sent once alongside Log Records and Error Events
(a Sink's and a Transport's second argument), never repeated inside each one.
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

**Locale**:
The language-and-region convention a number or a date is read and written in. Defaults to the
Runtime's own and can be constructed to override it. One value serves numbers and dates, so the two
in one application follow the same convention.
_Avoid_: language (a locale also fixes region-specific conventions), culture

**Local Value**:
A date, a time or a date and time with no time zone: `LocalDate`, `LocalTime`, `LocalDateTime`.
It names a point on a calendar or a clock face, not an instant. The zone is consulted only to
read the current moment (`now()`), never to build, compare or format one. Owned by
`@vipengele/ts-core-common`.
_Avoid_: timestamp, instant (an Instant is the term for a point on the timeline), `Date` (carries
an implicit zone)

**Instant**:
A point on the UTC timeline, to the nanosecond, independent of any calendar or zone. It becomes a
Local Value only by being read in a Zone. Owned by `@vipengele/ts-core-common`.
_Avoid_: timestamp, `Date` (millisecond-only, and carries an implicit zone)

**Zone**:
A named IANA time zone, such as `Europe/Berlin`, whose rules fix the UTC offset at each Instant. A
UTC offset like `+05:30` is not a Zone: it has no rules of its own. Represented by `ZoneId`.
_Avoid_: timezone (write "time zone" in prose; `ZoneId` is the type), offset

**Zoned value**:
A Local Value of date and time paired with a Zone, which together fix exactly one Instant. Where
the zone's rules make a local time ambiguous or nonexistent, the pairing is what resolves it.
Represented by `ZonedDateTime`, which also holds the offset the date and time read in.
_Avoid_: datetime with offset, timestamp

**Disambiguation**:
The mode that settles a Gap or an Overlap when a local value is resolved in a Zone: `compatible`
(the default, as in `java.time`), `earlier`, `later` or `reject`. Passed as the `disambiguation`
option wherever a local value meets a zone.
_Avoid_: resolver, strategy, policy (a Redaction policy is unrelated)

**Gap**:
A span of local time a Zone skips when its offset moves forward, such as 02:00 to 03:00 on a
spring-forward night. A local value in it names no Instant.
_Avoid_: DST hole, nonexistent time

**Overlap**:
A span of local time a Zone reads twice when its offset moves back, such as 02:00 to 03:00 on a
fall-back night. A local value in it names two Instants.
_Avoid_: ambiguous time, repeated hour

**Integration**:
A piece a Reporter installs when it is created and removes when it is closed, such as a listener on
global state. Added to the builder by `name`; adding the same name again replaces the earlier one.

**Global Handler**:
The Integration that captures the errors nothing else caught: the uncaught exceptions and unhandled
rejections of a Node process, the `error` and `unhandledrejection` events of a browser page.
Its events are always unhandled.

**Exit Policy**:
What a Node process does after a Global Handler captures an error: `"exit"` or `"continue"`. The
caller chooses each one; there is no default.
