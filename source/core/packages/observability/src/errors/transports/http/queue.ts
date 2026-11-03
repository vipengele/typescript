import type { Resource } from "@vipengele/ts-core-common/scope";
import type { ErrorEvent } from "../../event";

/**
 * Why the HTTP transport gave up on an event without delivering it: the queue was full, the event
 * alone exceeds the batch byte limit, its retries ran out, the endpoint refused it, it could not be
 * serialized or sent at all, or the transport closed with it still pending.
 */
export type DropReason = "queue-full" | "too-large" | "retries-exhausted" | "rejected" | "unsendable" | "closed";

/** The bounds an {@link EventQueue} holds to. Every value is a positive integer. */
export interface QueueLimits {
  /** The most events the queue holds at once. */
  readonly maxQueueEvents: number;
  /** The most estimated bytes the queue holds at once, summed over its events. */
  readonly maxQueueBytes: number;
  /** The most events one batch holds. */
  readonly maxBatchEvents: number;
  /** The most estimated bytes one batch holds, and the most one event may measure. */
  readonly maxBatchBytes: number;
}

/** Events that leave the queue together, all pushed with a structurally equal Resource. */
export interface Batch {
  readonly events: ErrorEvent[];
  /** The Resource the batch's first event was pushed with. */
  readonly resource: Resource;
}

/** A bounded, in-memory FIFO of events awaiting delivery, each with the Resource it was sent with. */
export interface EventQueue {
  /** The number of events held. */
  readonly size: number;
  /** The estimated bytes held, summed over every event. */
  readonly bytes: number;
  readonly isEmpty: boolean;
  /**
   * Appends `event`, or refuses it and returns why: `"unsendable"` when `JSON.stringify` throws on
   * it, `"too-large"` when it alone measures more than `maxBatchBytes`, `"queue-full"` when holding
   * it would exceed `maxQueueEvents` or `maxQueueBytes`. A refused event leaves the queue as it was.
   */
  push(event: ErrorEvent, resource: Resource): DropReason | undefined;
  /**
   * Removes and returns the run of events at the head that share the head's Resource, cut short at
   * `maxBatchEvents` events or before the event that would take it past `maxBatchBytes`.
   * `undefined` when the queue is empty.
   */
  takeBatch(): Batch | undefined;
  /** Removes and returns every event held, in order. */
  drain(): ErrorEvent[];
}

interface Entry {
  readonly event: ErrorEvent;
  readonly resource: Resource;
  readonly key: string;
  readonly bytes: number;
}

// Built from a record so `satisfies` rejects a missing or extra key; a non-integer string key keeps
// insertion order, which fixes the order the key is built in.
const RESOURCE_KEYS = Object.keys({
  "service.name": true,
  "service.version": true,
  "service.dist": true,
  "deployment.environment.name": true,
  "process.runtime.name": true,
  "process.runtime.version": true,
  "os.type": true,
  "os.version": true,
  "browser.name": true,
  "browser.version": true,
  "device.type": true,
} satisfies Record<keyof Resource, true>) as (keyof Resource)[];

const encoder = new TextEncoder();

/**
 * A string equal for two Resources exactly when every one of the eleven keys holds the same value.
 * `Scope.resource()` returns a new frozen object on every read, so identity never matches across
 * two sends. An absent value is written as `null`, apart from every string, `""` included.
 */
export function resourceKey(resource: Resource): string {
  return JSON.stringify(RESOURCE_KEYS.map((key) => resource[key] ?? null));
}

/**
 * The UTF-8 byte length of `JSON.stringify(event)`: the size the queue and batch byte bounds count.
 * Throws whatever `JSON.stringify` throws, such as on a BigInt or a cycle.
 */
export function estimateSize(event: ErrorEvent): number {
  return encoder.encode(JSON.stringify(event)).byteLength;
}

/** Creates an empty {@link EventQueue} bounded by `limits`. */
export function createEventQueue(limits: QueueLimits): EventQueue {
  // Live entries are `entries[head..]`. Taking a batch advances `head` and compacts only once the
  // consumed prefix is at least as long as what remains, so each call costs O(batch) amortized
  // rather than shifting the whole array.
  const entries: Entry[] = [];
  let head = 0;
  let bytes = 0;

  return {
    get size() {
      return entries.length - head;
    },
    get bytes() {
      return bytes;
    },
    get isEmpty() {
      return entries.length === head;
    },
    push(event, resource) {
      let size: number;
      try {
        size = estimateSize(event);
      } catch {
        return "unsendable";
      }
      if (size > limits.maxBatchBytes) {
        return "too-large";
      }
      if (entries.length - head + 1 > limits.maxQueueEvents || bytes + size > limits.maxQueueBytes) {
        return "queue-full";
      }
      entries.push({ event, resource, key: resourceKey(resource), bytes: size });
      bytes += size;
      return undefined;
    },
    takeBatch() {
      const first = entries[head];
      if (first === undefined) {
        return undefined;
      }
      // The head always fits: push refuses an event larger than `maxBatchBytes`.
      let count = 1;
      let batchBytes = first.bytes;
      while (head + count < entries.length && count < limits.maxBatchEvents) {
        const next = entries[head + count] as Entry;
        if (next.key !== first.key || batchBytes + next.bytes > limits.maxBatchBytes) {
          break;
        }
        batchBytes += next.bytes;
        count += 1;
      }
      bytes -= batchBytes;
      const events = entries.slice(head, head + count).map((taken) => taken.event);
      head += count;
      if (head === entries.length) {
        entries.length = 0;
        head = 0;
      } else if (head * 2 >= entries.length) {
        entries.splice(0, head);
        head = 0;
      }
      return { events, resource: first.resource };
    },
    drain() {
      const events = entries.slice(head).map((held) => held.event);
      entries.length = 0;
      head = 0;
      bytes = 0;
      return events;
    },
  };
}
