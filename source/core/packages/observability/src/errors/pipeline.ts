import { type AttributesInput, type Level, normalizeAttributes, type SerializedError, serializeError } from "@vipengele/ts-core-common";
import type { Clock } from "./builder";
import type { ErrorEvent, ExceptionRecord, Mechanism } from "./event";
import { createEventId } from "./event-id";
import type { Transport } from "./transport";

/** What a caller hands the pipeline: a thrown value or a message, plus its own level and attributes. */
export type CaptureInput =
  | { readonly kind: "exception"; readonly error: unknown; readonly level?: Level; readonly attributes?: AttributesInput }
  | { readonly kind: "message"; readonly message: string; readonly level?: Level; readonly attributes?: AttributesInput };

/** Runs one event through the pipeline and returns its id, whether or not the event reached the transport. Never throws. */
export type Capture = (input: CaptureInput, mechanism: Mechanism) => string;

/** Returns the event it is given, or a replacement for it; a throw drops the event. */
export type Processor = (event: ErrorEvent) => ErrorEvent;

/** Returns `false` to drop the event; a throw drops it too. */
export type Filter = (event: ErrorEvent) => boolean;

/** Everything one Reporter's pipeline reads for every event it runs. */
export interface Pipeline {
  readonly clock: Clock;
  readonly transport?: Transport | undefined;
  readonly processors: readonly Processor[];
  readonly filters: readonly Filter[];
}

/** An event after normalization, before enrichment: the payload a caller handed over, and nothing else. */
type NormalizedPayload = Pick<ErrorEvent, "message" | "exception">;

/**
 * The level table. Membership is an own-key check, so a name that exists only on
 * `Object.prototype`, such as `"constructor"`, is not a level.
 */
const LEVELS: Readonly<Record<Level, true>> = Object.freeze({
  trace: true,
  debug: true,
  info: true,
  warn: true,
  error: true,
  fatal: true,
});

/** Anything that is not one of the six levels becomes `"error"`. */
function toLevel(level: unknown): Level {
  return typeof level === "string" && Object.hasOwn(LEVELS, level) ? (level as Level) : "error";
}

/** Lifts a serialized error to an {@link ExceptionRecord}, giving every link of its `cause`/`errors` chain its own `frames`. */
function toExceptionRecord(serialized: SerializedError): ExceptionRecord {
  const { cause, errors, ...rest } = serialized;
  const record: ExceptionRecord = { ...rest, frames: [] };
  if (cause !== undefined) {
    record.cause = toExceptionRecord(cause);
  }
  if (errors !== undefined) {
    record.errors = errors.map(toExceptionRecord);
  }
  return record;
}

/** Stage 1: the caller's thrown value or message, in the Error Event's shape. */
function normalize(input: CaptureInput): NormalizedPayload {
  return input.kind === "exception" ? { exception: toExceptionRecord(serializeError(input.error)) } : { message: input.message };
}

/** Stage 2: stamps what the pipeline knows about the event rather than what the caller handed over. */
function enrich(payload: NormalizedPayload, input: CaptureInput, mechanism: Mechanism, id: string, pipeline: Pipeline): ErrorEvent {
  return {
    id,
    time: pipeline.clock(),
    level: toLevel(input.level),
    ...payload,
    mechanism,
    attributes: normalizeAttributes(input.attributes ?? {}),
  };
}

/**
 * Stages 3 to 5: processors in order, then filters in order, then the transport. Returns without
 * sending once a filter drops the event.
 */
function deliver(event: ErrorEvent, pipeline: Pipeline): void {
  const processed = pipeline.processors.reduce((current, processor) => processor(current), event);
  if (!pipeline.filters.every((filter) => filter(processed))) {
    return;
  }
  pipeline.transport?.send(processed);
}

/**
 * Creates the function every capture goes through — `captureException`, `captureMessage`, and any
 * handler that hands the reporter an error with its own {@link Mechanism}. It runs normalize,
 * enrich, processors, filters and the transport, in that order, every time. A stage or a
 * `transport.send` that throws drops the event silently: the id is returned either way, since a
 * transport is fire-and-forget and the caller learns nothing of delivery (ADR-0010).
 */
export function createCapture(pipeline: Pipeline): Capture {
  return (input, mechanism) => {
    const id = createEventId();
    try {
      deliver(enrich(normalize(input), input, mechanism, id, pipeline), pipeline);
    } catch {
      // The event is dropped; a capture never throws.
    }
    return id;
  };
}
