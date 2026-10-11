# Logger processors fail closed and run after the built-in redaction

A Log Processor is a function from a record to a record or `null`:

```ts
type LogProcessor = (record: LogRecord) => LogRecord | null;
```

`null` drops the record. `builder.addProcessor(p)` registers a global processor that runs ahead of
every Sink; `builder.addSink(sink, { processors })` registers processors that run ahead of that Sink
alone, after the global chain. Each chain runs in the order added, each processor on what the
previous one returned.

## Fail closed

A processor that throws, or returns something that is not an object carrying `time`, `level`,
`category` and a string `message`, or an `error` link that is not an object with a string `type`
and `message`, drops the record: a filter that fails open would deliver the very record it exists
to withhold. A global processor's failure drops the record for every Sink, a per-sink processor's
for that Sink only. A returned record is rebuilt from the `LogRecord` fields alone, dropping any
other key. Its `attributes` and every error link's `data` go back through `normalizeAttributes`,
an error link that recurs on its own chain becomes a `"[Circular]"` link as `serializeError` gives
it, and the parts the processor passed on from the record it was handed are kept as they are
rather than bounded twice. The rebuilt copy is deeply frozen, never the processor's own objects. A
Sink only ever receives a JSON-safe, frozen record. `build()` throws `LoggingConfigError` for a processor that is not a function, for
`addSink` options that are not an object and for `processors` that is not an array (ADR-0002).

## Built-in redaction is the fixed first stage

The redaction of ADR-0011 runs when the record is built, before any processor. `builder.redaction(null)`
still disables it. The guarantee of ADR-0007 reads: redacted before processors, JSON-safe always.
`redactionProcessor(policy = secretKeys)` is the opt-in extra for a different policy on one Sink. It
reuses the logger's attribute and error-chain redaction and does not scan `message`, as the built-in
stage does.

## Failures are reported once per source on the warn path only

`onSinkError(error, source)` receives the failing `Sink` or `LogProcessor`. The default warn path
(`Logging` and `Logging.createProvider`, which set `sinkErrorsOncePerSource` on the provider options) warns once per source
per configuration, keyed by identity in a `WeakSet`, and the text says whether a sink or a processor
failed. `configure` and `reset` clear the set; `override` does not, since it rebuilds the settings
without changing the sinks. A Sink added twice, or a processor shared by the global and a per-sink
chain, is reported once. A host-supplied `onSinkError` without that option receives every failure.

## Considered options

- **Redaction as an ordinary default processor.** `redaction(null)` and a custom chain could then
  remove or reorder it, which breaks the secure default and the guarantee of ADR-0007.
- **A separate Processor and Filter pair, as the Reporter has.** The Reporter's pipeline has no
  public API, so there is nothing to stay consistent with, and a processor that returns `null`
  covers both.
- **Failing open.** A throwing processor would pass the record on unprocessed, which for a
  redacting or dropping processor delivers what it was meant to stop.
- **Deduplicating before the host callback.** A host that wants every failure, to count them,
  could not get them.

## Consequences

- `OutputSettings.sinks` is `readonly SinkRegistration[]`, each `{ sink, processors }`: a break of
  the exported snapshot type, made in a 0.0.x package.
- Per-sink level thresholds and Sink `flush`/`close` are not part of this decision.
