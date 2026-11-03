# The offline queue persists encoded bodies behind an internal drop hook

This amends the offline-queue decision of `0010-the-transport-contract-is-fire-and-forget.md` and
the `onDrop` sentence of `0022-otlp-export-shares-one-delivery-core.md`. The other decisions of both
stand.

The scope of this decision is the delivery core (`src/delivery/`) and the two transports built on
it, `createOtlpLogSink` and `createOtlpTransport`. `createHttpTransport` keeps its own queue and wire
format (`0023-http-json-transport-delivery.md`) and is not covered here: its offline queue and its
unload drain are decided separately, and this ADR is extended when they are.

## What persists

Only a batch that was valid but undelivered: `retries-exhausted`, `unload-budget` and `closed`. A
`rejected` batch is one the collector will never accept, and a `queue-full` item was refused before
it was batched, so neither is stored.

The queue stores the encoded request body, a string, with its entry count. Error Events, Log Records
and the Resource are plain data, but a stored object would need a schema version and a migration each
time one changes; a body is opaque to the store and replays as it was encoded.

## Replay

A queue replays its own records when it is created and on the window `online` event, oldest first,
one request at a time, outside the core's buffer, with headers from the current configuration.

- A 2xx response deletes the record.
- A non-retryable status deletes it and reports `rejected`.
- A network error or a retryable status stops the replay and keeps the record.

`flush` and `close` do not wait for a replay.

## API

The option is opt-in and off by default, on `OtlpLogSinkOptions` and `OtlpTransportOptions`:
`offline?: true | { maxEntries?: number; maxBytes?: number; indexedDB?: IDBFactory }`, with
defaults of 30 entries and 1 MiB. There is one database, `vipengele-otlp-offline`. A record is keyed
by endpoint URL and source (`logs` or `errors`), and a queue replays only its own key. The bounds
count every key together and keep the oldest: a batch that would exceed them is not stored.

## The core reports undelivered entries through an internal hook

The public `onDrop(reason, count)` of the core is unchanged. `DeliveryOptions` gains an internal
`undelivered(entries, reason)` hook, absent from the wrappers' public option types. When it is set,
`retries-exhausted`, `unload-budget` and `closed` call it instead of `onDrop`; `queue-full` and
`rejected` still go to `onDrop`. A throwing hook is swallowed like `onDrop`.

## Drop reporting

`offline-full` is a reason of the wrapper, not of the core, whose `DropReason` stays the set of
reasons the core emits. The wrappers' `OtlpDropReason` and `OtlpTransportDropReason` are
`DropReason | "offline-full"`; the widening is visible to an exhaustive switch.

- A batch stored in IndexedDB is not reported.
- A batch the store refuses as full is reported as `offline-full`.
- A write that fails (quota, an aborted transaction, a connection closed by `versionchange`), or a
  store that is unavailable, reports the batch with its original reason.

With `offline` on, these reports arrive after the store's asynchronous outcome, not synchronously.

## A store that is not open yet

A write issued before the open settles waits in memory and counts against the same `maxEntries` and
`maxBytes`; over the bound it is reported as `offline-full`. It is written once the store opens, and
reported with its original reason if the open fails.

## close waits for writes

The wrapper's `close(timeoutMs)` awaits the core's `close`, then awaits pending store writes within
what is left of the same timeout, and resolves `false` if a write is still pending. `flush` waits for
writes the same way and never for a replay. On `pagehide` the write of the unload-budget remainder is
started but cannot be awaited, so it is best-effort.

## Delivery is at-least-once

Two tabs, or two queues on one URL, may replay the same body before either deletes it, and a `closed`
batch whose in-flight fetch was aborted may already have reached the collector. The collector must
tolerate a repeated body. No lease coordinates tabs.

## A network error while offline skips the remaining retries

A network-error attempt while `navigator.onLine === false` ends the batch as `retries-exhausted` at
once, so it is persisted without backoff. When `onLine` is `true`, or is not a boolean (Node), retries
run as usual. The navigator is injectable for tests.

## The `online` event comes from the lifecycle window

The queue listens on `options.lifecycle?.window ?? detectLifecycleTargets().window`. `lifecycle: {}`
therefore also disables `online`-triggered replay; replay at creation still runs.

## Location

The store and the queue live in `src/delivery/offline/`, internal and unexported, because `./logger`
and `./errors` both use them and never import each other. This differs from the `src/errors/`
location the issue asked for.

## Considered options

- **A public `onDrop` that carries the dropped entries.** It would make every entry part of the
  public contract of both wrappers, and a caller that ignores the count would pay for entries it
  never reads.
- **Persisting entries and re-enqueueing them on replay.** It needs a schema version for each shape
  and sends a replayed entry back through batching, retry and the unload budget, where it can be
  dropped or persisted again.
- **Always retrying before persisting.** An offline page spends its whole backoff before the batch is
  stored, and a page closed in that time loses it.
- **An injectable public store.** Every embedder would implement the bounds, ordering and failure
  handling the queue depends on; only the `IDBFactory` is injectable.
- **A cross-tab lease.** It needs a lock or a heartbeat that not every runtime has, to remove a
  duplicate the collector has to tolerate anyway, since an aborted in-flight fetch can duplicate a
  batch without a second tab.
