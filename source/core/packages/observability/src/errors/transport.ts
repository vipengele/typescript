import type { Resource } from "@vipengele/ts-core-common/scope";
import type { ErrorEvent } from "./event";

/**
 * Where an Error Event goes once captured (ADR-0010). Fire-and-forget: `send` returns at once and
 * never throws, and the reporter never awaits it — batching, retry and the decision to drop belong
 * to the transport.
 */
export interface Transport {
  /**
   * Accepts `event` and returns at once. `resource` is the {@link Resource} read once for this
   * event at delivery, frozen, and every one of its keys present whether or not it has a value.
   */
  send(event: ErrorEvent, resource: Resource): void;
  /** Resolves `true` once everything accepted so far is delivered or dropped, `false` if `timeoutMs` elapses first. */
  flush(timeoutMs?: number): Promise<boolean>;
  /** Flushes, then turns every later `send` into a no-op. */
  close(timeoutMs?: number): Promise<boolean>;
}
