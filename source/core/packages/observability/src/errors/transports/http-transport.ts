import type { Resource } from "@vipengele/ts-core-common/scope";
import { drain, openOffline } from "../../delivery/offline/wrapper";
import type { StatusClass } from "../../delivery/retry-policy";
import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";
import { classify } from "./http/classify";
import { type HttpTransportOptions, resolveOptions } from "./http/options";
import { createEventQueue, type DropReason } from "./http/queue";
import { encodeBatch, type RequestDropReason, type RequestOptions, type Settlement, sendBatch } from "./http/request";

/** The drop reasons whose events the offline queue saves instead of reporting. */
type SavedReason = "retries-exhausted" | "closed";

/** How the offline queue reads a replay's status: the transport's own classification. */
function replayClass(status: number): StatusClass {
  const verdict = classify(status);
  return verdict === "retry" ? "retryable" : verdict;
}

/** A pending `flush`: resolved once `settled` reaches `target`, or by its timeout. */
interface FlushWaiter {
  readonly target: number;
  finish(drained: boolean): void;
}

/**
 * Creates a {@link Transport} that POSTs Error Events to `options.url` in batches, retrying a
 * network error, an attempt that outlives `requestTimeoutMs`, 408, 429 or 5xx with backoff or the
 * response's `Retry-After`. Throws `HttpTransportConfigError` here for an invalid option; `send`
 * never throws.
 *
 * `send` queues the event and returns. The first event queued while nothing is lingering or in
 * flight starts a `lingerMs` wait on the Scheduler that gathers the events sent during it; when it
 * ends, batches go out one request at a time, back to back, until the queue is empty. Only the
 * first batch lingers, and a backoff or `Retry-After` wait holds back every batch behind it.
 *
 * An event given up on goes to `onDrop` with its reason, or, with no `onDrop`, produces one
 * `console.warn` per reason for the transport's lifetime. A throwing `onDrop` or `console.warn` is
 * swallowed.
 *
 * `flush` ends a pending linger at once but waits out a backoff or `Retry-After` wait. It resolves
 * `true` once every event accepted before the call is delivered or dropped, and `false` when
 * `timeoutMs`, timed on the Scheduler, elapses first; events sent after the call are not waited on.
 *
 * `close` turns every later `send` into a no-op, flushes with `timeoutMs`, then aborts the request
 * in flight and drops the events of its batch not yet settled, and everything still queued, as
 * `"closed"`, resolving to the flush's result. A part of a batch split for size that settled
 * before the abort keeps its own outcome. The aborted request's own settlement is ignored, so a `fetch` that disregards its signal
 * cannot hold `close` open. A second `close` returns the first one's promise; a `flush` after
 * `close` resolves `true` once `close` has.
 *
 * With `offline`, a batch given up on as `"retries-exhausted"` or `"closed"` is saved in IndexedDB,
 * under `${url}|http-errors`, as the exact request body, and replayed as it is; it reaches `onDrop`
 * only once the save fails (with its own reason) or the store refuses it as `"offline-full"`, after
 * the save's outcome. A network error or a timeout while the navigator reports no network ends the
 * batch's retries at once. A saved body the endpoint rejects on replay reaches `onDrop` as
 * `"rejected"` with no events. `flush` and `close` also wait for pending saves, resolving `false`
 * if one outlasts the timeout, and `close` closes the store.
 *
 * Nothing is `unref`'d and no exit hook is registered: a process that must not lose events
 * awaits `close` before it exits.
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  const resolved = resolveOptions(options);
  const { scheduler, console: warnings } = resolved;
  const { onDrop } = resolved;
  const queue = createEventQueue(resolved);
  const stop = new AbortController();
  const warned = new Set<DropReason>();
  const waiters = new Set<FlushWaiter>();
  const offline = openOffline<never>({
    url: resolved.url,
    headers: resolved.headers,
    contentType: resolved.contentType,
    requestTimeoutMs: resolved.requestTimeoutMs,
    classify: replayClass,
    fetch: resolved.fetch,
    clock: resolved.clock,
    scheduler,
    // Only a saved body the endpoint rejects on replay reaches the queue's own drop report.
    onDrop: () => report([], "rejected"),
    offline: resolved.offline,
    keySuffix: "http-errors",
  });
  const requestOptions: RequestOptions = offline === undefined ? resolved : { ...resolved, isOffline: offline.queue.isOffline };

  let accepted = 0;
  let settled = 0;
  let linger: AbortController | undefined;
  let sending = false;
  /** The events of the batch being sent that have not settled yet, in batch order. */
  let inFlight: ErrorEvent[] = [];
  /** The Resource of the batch being sent. */
  let inFlightResource: Resource | undefined;
  let closed = false;
  let closing: Promise<boolean> | undefined;

  function report(events: readonly ErrorEvent[], reason: DropReason): void {
    try {
      if (onDrop !== undefined) {
        onDrop(events, reason);
      } else if (!warned.has(reason)) {
        warned.add(reason);
        warnings?.warn(`HTTP transport dropped ${events.length} event(s): ${reason}. Later "${reason}" drops are not reported.`);
      }
    } catch {
      // A failing drop report must not reach `send`'s caller or stop the send loop.
    }
  }

  /** Counts `count` accepted events as delivered or dropped and resolves every flush they complete. */
  function settle(count: number): void {
    settled += count;
    for (const waiter of waiters) {
      if (waiter.target <= settled) {
        waiter.finish(true);
      }
    }
  }

  function drop(events: readonly ErrorEvent[], reason: DropReason): void {
    if (events.length === 0) {
      return;
    }
    report(events, reason);
    settle(events.length);
  }

  /**
   * Gives up on `events` as `reason`: saves them as `body` with offline on and a body to save,
   * reporting them only if the save fails, and drops them otherwise.
   */
  function giveUp(events: readonly ErrorEvent[], reason: SavedReason, body: string | undefined): void {
    if (offline === undefined || body === undefined) {
      drop(events, reason);
      return;
    }
    // A refused save reports `"offline-full"` or the reason it was given, never another delivery reason.
    offline.queue.saveBody(body, events.length, reason, (dropped) => report(events, dropped === "offline-full" ? dropped : reason));
    settle(events.length);
  }

  /** Gives up on `events` as `"closed"`, encoded into the bodies a request would send them as. */
  function giveUpClosed(events: ErrorEvent[], resource: Resource): void {
    for (const group of encodeBatch({ events, resource }, resolved)) {
      giveUp(group.events, "closed", group.body);
    }
  }

  /** Gives up on the unsettled part of the batch in flight and everything still queued, as `"closed"`. */
  function abandonPending(): void {
    const unsettled = inFlight;
    inFlight = [];
    if (offline === undefined) {
      drop(unsettled, "closed");
      drop(queue.drain(), "closed");
      return;
    }
    if (unsettled.length > 0) {
      giveUpClosed(unsettled, inFlightResource as Resource);
    }
    for (let batch = queue.takeBatch(); batch !== undefined; batch = queue.takeBatch()) {
      giveUpClosed(batch.events, batch.resource);
    }
  }

  /** Runs `run`, a flush or a close, and with offline on also waits for the saves it leaves pending. */
  function settleSaves(
    run: (timeoutMs: number | undefined) => Promise<boolean>,
    closing: boolean,
    timeoutMs: number | undefined,
  ): Promise<boolean> {
    return offline === undefined ? run(timeoutMs) : drain(run, offline, closing, resolved.clock, timeoutMs, undefined);
  }

  /** Counts a settled group of the batch in flight as delivered or dropped. */
  function onSettle({ events, outcome, body }: Settlement): void {
    if (stop.signal.aborted) {
      // `close` has dropped what was still in flight. An `"aborted"` group only settles after `stop`
      // aborts, so it never gets past this check.
      return;
    }
    // Groups settle in batch order, so a settled group is always the head of what is in flight.
    inFlight = inFlight.slice(events.length);
    if (outcome === "delivered") {
      settle(events.length);
    } else if (outcome === "retries-exhausted") {
      giveUp(events, outcome, body);
    } else {
      drop(events, outcome as RequestDropReason);
    }
  }

  async function run(): Promise<void> {
    for (let batch = queue.takeBatch(); batch !== undefined; batch = queue.takeBatch()) {
      inFlight = batch.events;
      inFlightResource = batch.resource;
      await sendBatch(batch, requestOptions, stop.signal, onSettle);
      if (stop.signal.aborted) {
        // `close` has dropped the unsettled events and drained the queue.
        break;
      }
    }
    sending = false;
  }

  function startSending(): void {
    if (sending || queue.isEmpty) {
      return;
    }
    sending = true;
    void run();
  }

  function startLinger(): void {
    const controller = new AbortController();
    const fire = (): void => {
      // A linger cut short by `flush` rejects here after the batch has already been started.
      if (linger !== controller) {
        return;
      }
      linger = undefined;
      startSending();
    };
    void scheduler.sleep(resolved.lingerMs, controller.signal).then(fire, fire);
    linger = controller;
  }

  function cutLinger(): void {
    if (linger !== undefined) {
      const controller = linger;
      linger = undefined;
      controller.abort();
    }
  }

  function flushAccepted(timeoutMs: number | undefined): Promise<boolean> {
    const owed = accepted;
    if (settled >= owed) {
      return Promise.resolve(true);
    }
    cutLinger();
    startSending();
    return new Promise<boolean>((resolve) => {
      const timer = new AbortController();
      const waiter: FlushWaiter = {
        target: owed,
        finish(drained) {
          waiters.delete(waiter);
          timer.abort();
          resolve(drained);
        },
      };
      waiters.add(waiter);
      if (timeoutMs !== undefined) {
        scheduler.sleep(timeoutMs, timer.signal).then(
          () => waiter.finish(false),
          () => {
            // Aborted once the flush has resolved; a timeout the scheduler refuses leaves the flush untimed.
          },
        );
      }
    });
  }

  return {
    send(event, resource) {
      if (closed) {
        return;
      }
      try {
        const refused = queue.push(event, resource);
        if (refused !== undefined) {
          report([event], refused);
          return;
        }
        accepted += 1;
        if (!sending && linger === undefined) {
          startLinger();
        }
      } catch {
        // `send` never throws, whatever an injected scheduler does.
      }
    },
    flush(timeoutMs) {
      if (closing !== undefined) {
        return closing.then(() => true);
      }
      return settleSaves(flushAccepted, false, timeoutMs);
    },
    close(timeoutMs) {
      if (closing === undefined) {
        closed = true;
        const run = (budget: number | undefined): Promise<boolean> =>
          flushAccepted(budget).then((drained) => {
            stop.abort();
            abandonPending();
            return drained;
          });
        closing = settleSaves(run, true, timeoutMs);
      }
      return closing;
    },
  };
}
