import type { ErrorEvent } from "./event";

/**
 * Where an Error Event goes once captured (ADR-0010). Fire-and-forget: `send` returns at once and
 * never throws, and the reporter never awaits it — batching, retry and the decision to drop belong
 * to the transport.
 */
export interface Transport {
  /** Accepts `event` and returns at once. */
  send(event: ErrorEvent): void;
  /** Resolves `true` once everything accepted so far is delivered or dropped, `false` if `timeoutMs` elapses first. */
  flush(timeoutMs?: number): Promise<boolean>;
  /** Flushes, then turns every later `send` into a no-op. */
  close(timeoutMs?: number): Promise<boolean>;
}
