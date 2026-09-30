import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";

/** A {@link Transport} that records every sent event instead of delivering it anywhere. */
export interface TestTransport extends Transport {
  /** Every event accepted by `send` so far, oldest first. */
  readonly events: ErrorEvent[];
  /** Empties {@link TestTransport.events} without affecting whether the transport is closed. */
  clear(): void;
}

/** Creates a {@link TestTransport} for asserting what a reporter sent, without a network or a console. */
export function createTestTransport(): TestTransport {
  const events: ErrorEvent[] = [];
  let closed = false;

  return {
    events,
    clear() {
      events.length = 0;
    },
    send(event) {
      if (closed) {
        return;
      }
      events.push(event);
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
