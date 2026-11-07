# Breadcrumbs are a bounded buffer per Unit of Work

An Error Event is easier to diagnose with the trail of what happened just before it: the requests,
clicks and log lines of the same Unit of Work. This records what a Breadcrumb is, where the trail
lives, and how it reaches the wire. It supersedes the scope-tag Breadcrumb of
`0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md`, the `Breadcrumb[]` marking in
`0007-the-log-record-and-error-event-data-model.md` and the "nothing to map" of
`0022-otlp-export-shares-one-delivery-core.md`.

## Context

`0006` defined a Breadcrumb as a Scope's tag, with no buffer, and the trail as the tagged ancestors of
the capturing Scope. No code ever read a scope's tag into an event, so the trail was never emitted.
A tag walk also holds no time, level or data, and a step that is not a scope (a click, a log line)
cannot be recorded without creating one.

## Decisions

1. **A Breadcrumb is a timestamped entry in a bounded buffer; a Scope's tag is only its label.**
2. **One buffer per Unit of Work, on the Scope tree.** It sits in its own
   `Symbol.for("vipengele:scope:breadcrumbs")` slot on a scope node, beside the parent and attribute
   slots and outside the attributes, so `snapshot`, reserved-key checks and attribute redaction never
   see it. `Scope.isolated` and the default scope create a fresh buffer; `Scope.inherit` shares its
   parent's. `parent` stays unexposed (`0006`): the trail is read through a framework-internal reader
   exported from `./scope`, as `snapshot` is. A node built by an older copy of the package has no
   slot: it reads as an empty trail and `addBreadcrumb` on it is a silent no-op. The buffer is plain
   data, so a dual-resolved copy appends to the same one.
3. **Shape, normalized at record time.** `Scope.addBreadcrumb({ message, category?, level?, data?,
   time? })` stores a deep-frozen `Breadcrumb = { time: number; message: string; category?: string;
   level?: Level; data?: Attributes }`. `data` goes through `normalizeAttributes` with default limits
   when recorded, so the buffer holds no caller references and one `Breadcrumb` type is true in both
   packages. `time` is epoch milliseconds, defaulting to `systemClock`. Recording never throws: a
   non-string `message` drops the entry; a non-string `category`, a non-`Level` `level` or a
   non-object `data` drops that field only. The buffer holds 100 entries and evicts the oldest.
4. **Log Records become breadcrumbs inside `Reporter#loggerSink`**, on by default, and
   `{ breadcrumbs: false }` opts out. Each received record is recorded into `Scope.current()` as
   `{ time, message, category, level }` taken from the record, with no `data`: a record's attributes
   already merge the whole Scope chain, which the event carries once. An error record is captured
   first and recorded after, so an event never lists itself. A record arriving under the sink's
   re-entrancy guard is still recorded, not captured. Logger thresholds apply, so warn and above by
   default.
5. **Logger-sink events carry the trail too**, breadcrumbs only; their attributes still come from the
   record. This is a narrow exception to `0026`'s rule that `enrich` reads no Scope for a
   `serialized-exception` input.
6. **Controls.** `ReporterBuilder.maxBreadcrumbs(n)` takes an integer from 0 to 100, default 100, and
   0 turns the trail off; anything else throws `ReporterConfigError`. `ReporterBuilder.beforeBreadcrumb(hook)`
   maps each crumb, oldest first, on a copy, at attach time and before the newest-n slice; returning
   `null`, a non-object, or throwing drops that crumb only, as a processor does.
7. **Attaching never clears.** Each event gets a snapshot, because every Reporter shares the buffer.
8. **Wire.** `ErrorEvent.breadcrumbs?: Breadcrumb[]` is omitted when empty. It is attached in the
   `enrich` stage for every input kind, with each crumb's `data` re-cut to the Reporter's `limits`.
   The redaction stage redacts each crumb's `data` and `message` with the attribute policy, since a
   logger-sink crumb's message is the text an error event carries as the scanned `logger.message`
   attribute. Leaving the crumb message unscanned was rejected: the trail would be a weaker path for
   the same text, on every later event in the Unit of Work. Processors and `beforeSend` see the field; dedupe ignores it. The
   HTTP, console and test transports pass it through. OTLP exports it as the attribute
   `vipengele.breadcrumbs`, an `arrayValue` of `kvlistValue` built by `toAnyValue`, and the encoder
   owns that key like its other written keys.

## Hazard: a batching sink

`emit` calls a directly registered sink's `write` synchronously in the logging call's frame, so
`Scope.current()` there is the caller's scope. `createBatchingSink` defers `write` to flush time. A
`loggerSink` wrapped in a batching sink therefore records, and attaches to events, the trail of
whichever Unit of Work is current at flush. The result reads as correct data and nothing guards
against it. Add `loggerSink` to the logger directly, or pass `{ breadcrumbs: false }` when wrapping it.

## Considered options

- **A per-Reporter buffer, or a realm-global one.** Concurrent Units of Work would interleave in one
  trail.
- **Clearing the buffer on attach.** Several Reporters share one buffer, so the first to capture would
  empty the trail of the rest.
- **Normalizing only at attach time.** The buffer would retain caller object graphs, and the recorded
  and attached shapes would be two types under one name.
- **Logger breadcrumbs with `data`.** Repeated Scope attributes would swamp the payload.
- **An OTLP JSON string.** A structured `arrayValue` stays queryable at the backend.
- **A configurable scope cap.** The cap would differ between copies and callers; the Reporter's
  `maxBreadcrumbs` already narrows what is attached.
- **A realm clock slot.** `systemClock` is enough, and `time` can be given per crumb.

## Consequences

- The tag trail of `0006` is gone; nothing consumed it.
- The default scope's buffer lives as long as the realm and is never cleared, so a long-lived default
  scope shows the latest 100 crumbs.
- Events with no trail are unchanged on the wire.
