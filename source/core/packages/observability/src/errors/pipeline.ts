import {
  type Attributes,
  type AttributesInput,
  type Clock,
  isLevel,
  type Level,
  normalizeAttributes,
  type SerializedError,
  serializeError,
} from "@vipengele/ts-core-common";
import { Scope, snapshot } from "@vipengele/ts-core-common/scope";
import type { ErrorEvent, ExceptionRecord, Mechanism } from "./event";
import { createEventId } from "./event-id";
import { markInApp } from "./stack/in-app";
import { parseStack } from "./stack/parse-stack";
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
  /** What counts as in-app when frames are marked; every frame outside `node_modules` is in-app when absent. */
  readonly projectRoot?: string | undefined;
}

/** An event after normalization, before enrichment: the payload a caller handed over, and nothing else. */
type NormalizedPayload = Pick<ErrorEvent, "message" | "exception">;

/** Anything that is not one of the six levels becomes `"error"`. */
function toLevel(level: unknown): Level {
  return isLevel(level) ? level : "error";
}

/** Lifts a serialized error to an {@link ExceptionRecord}, giving every link of its `cause`/`errors` chain its own `frames`. */
function toExceptionRecord(serialized: SerializedError, projectRoot: string | undefined): ExceptionRecord {
  const { cause, errors, ...rest } = serialized;
  const record: ExceptionRecord = { ...rest, frames: markInApp(parseStack(serialized.stack), projectRoot) };
  if (cause !== undefined) {
    record.cause = toExceptionRecord(cause, projectRoot);
  }
  if (errors !== undefined) {
    record.errors = errors.map((link) => toExceptionRecord(link, projectRoot));
  }
  return record;
}

/** Stage 1: the caller's thrown value or message, in the Error Event's shape. */
function normalize(input: CaptureInput, pipeline: Pipeline): NormalizedPayload {
  return input.kind === "exception"
    ? { exception: toExceptionRecord(serializeError(input.error), pipeline.projectRoot) }
    : { message: input.message };
}

/**
 * The current Scope's attributes, from the default scope inward, never the Resource. A throw while
 * reading or normalizing them yields an empty record, so the event still goes out with the call's
 * own attributes instead of being dropped.
 */
function scopeAttributes(): Attributes {
  try {
    return normalizeAttributes(snapshot(Scope.current()));
  } catch {
    return {};
  }
}

const TRUNCATION_MARKER = /^\[Truncated: \d+ more\]$/;

/** The first `<key>#<n>` that neither side already holds. */
function freeKey(key: string, scope: Attributes, call: Attributes): string {
  for (let suffix = 1; ; suffix++) {
    const candidate = `${key}#${suffix}`;
    if (!Object.hasOwn(scope, candidate) && !Object.hasOwn(call, candidate)) {
      return candidate;
    }
  }
}

/**
 * The scope's attributes beneath the call's own, the call's winning on a shared key. Each side is
 * normalized on its own, so the breadth bound applies per side and a large scope chain cannot push
 * a call attribute into the truncation marker. Both sides name their marker by the same key, so a
 * scope-side marker that collides with a call key moves to a free `<key>#<n>` rather than being
 * overwritten, and the event still shows that the scope chain was cut. `Object.fromEntries` defines
 * every key as an own data property, so a `__proto__` key stays a key instead of replacing the
 * result's prototype.
 */
function mergeAttributes(scope: Attributes, call: Attributes): Attributes {
  const scopeEntries = Object.entries(scope).map(([key, value]): [string, Attributes[string]] => [
    typeof value === "string" && TRUNCATION_MARKER.test(value) && Object.hasOwn(call, key) ? freeKey(key, scope, call) : key,
    value,
  ]);
  return Object.fromEntries([...scopeEntries, ...Object.entries(call)]);
}

/** Stage 2: stamps what the pipeline knows about the event rather than what the caller handed over. */
function enrich(payload: NormalizedPayload, input: CaptureInput, mechanism: Mechanism, id: string, pipeline: Pipeline): ErrorEvent {
  return {
    id,
    time: pipeline.clock(),
    level: toLevel(input.level),
    ...payload,
    mechanism,
    attributes: mergeAttributes(scopeAttributes(), normalizeAttributes(input.attributes ?? {})),
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
      deliver(enrich(normalize(input, pipeline), input, mechanism, id, pipeline), pipeline);
    } catch {
      // The event is dropped; a capture never throws.
    }
    return id;
  };
}
