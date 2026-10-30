import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";
import { type HttpTransportOptions, resolveOptions } from "./http/options";
import { createEventQueue, type DropReason } from "./http/queue";
import { type RequestDropReason, sendBatch } from "./http/request";

/** A pending `flush`: resolved once `settled` reaches `target`, or by its timeout. */
interface FlushWaiter {
  readonly target: number;
  finish(drained: boolean): void;
}

/**
 * Creates a {@link Transport} that POSTs Error Events to `options.url` in batches, retrying a
 * network error, 408, 429 or 5xx with backoff or the response's `Retry-After`. Throws
 * `HttpTransportConfigError` here for an invalid option; `send` never throws.
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
 * in flight and drops it and everything still queued as `"closed"`, resolving to the flush's
 * result. The aborted request's own settlement is ignored, so a `fetch` that disregards its signal
 * cannot hold `close` open. A second `close` returns the first one's promise; a `flush` after
 * `close` resolves `true` once `close` has.
 *
 * Nothing is `unref`'d and no exit hook is registered: a process that must not lose events
 * awaits `close` before it exits.
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  const resolved = resolveOptions(options);
  const { scheduler, onDrop, console: warnings } = resolved;
  const queue = createEventQueue(resolved);
  const stop = new AbortController();
  const warned = new Set<DropReason>();
  const waiters = new Set<FlushWaiter>();

  let accepted = 0;
  let settled = 0;
  let linger: AbortController | undefined;
  let sending = false;
  let inFlight: ErrorEvent[] | undefined;
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

  async function run(): Promise<void> {
    for (let batch = queue.takeBatch(); batch !== undefined; batch = queue.takeBatch()) {
      inFlight = batch.events;
      const result = await sendBatch(batch, resolved, stop.signal);
      if (stop.signal.aborted) {
        // `close` has dropped this batch and drained the queue.
        break;
      }
      inFlight = undefined;
      for (const { events, outcome } of result) {
        if (outcome === "delivered") {
          settle(events.length);
        } else {
          // `"aborted"` only follows `stop` aborting, which the check above has already handled.
          drop(events, outcome as RequestDropReason);
        }
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
      return flushAccepted(timeoutMs);
    },
    close(timeoutMs) {
      if (closing === undefined) {
        closed = true;
        closing = flushAccepted(timeoutMs).then((drained) => {
          stop.abort();
          drop(inFlight ?? [], "closed");
          inFlight = undefined;
          drop(queue.drain(), "closed");
          return drained;
        });
      }
      return closing;
    },
  };
}
