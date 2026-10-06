import type { Resource } from "@vipengele/ts-core-common/scope";
import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";

/** A {@link Transport} that records every sent event, and the Resource it was sent with, instead of delivering it anywhere. */
export interface TestTransport extends Transport {
  /** Every event accepted by `send` so far, oldest first. */
  readonly events: ErrorEvent[];
  /** The Resource each event in {@link TestTransport.events} was sent with, at the same index. */
  readonly resources: Resource[];
  /** Empties {@link TestTransport.events} and {@link TestTransport.resources} without affecting whether the transport is closed. */
  clear(): void;
}

/** Creates a {@link TestTransport} for asserting what a reporter sent, without a network or a console. */
export function createTestTransport(): TestTransport {
  const events: ErrorEvent[] = [];
  const resources: Resource[] = [];
  let closed = false;

  return {
    events,
    resources,
    clear() {
      events.length = 0;
      resources.length = 0;
    },
    send(event, resource) {
      if (closed) {
        return;
      }
      events.push(event);
      resources.push(resource);
    },
    async flush() {
      return true;
    },
    async close() {
      closed = true;
      return true;
    },
  };
}
