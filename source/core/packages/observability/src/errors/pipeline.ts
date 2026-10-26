import {
  type Attributes,
  type AttributesInput,
  type Clock,
  isLevel,
  type Level,
  normalizeAttributes,
  type SerializedError,
  type SerializeErrorOptions,
  serializeError,
  toJsonSafe,
} from "@vipengele/ts-core-common";
import { type Resource, Scope, snapshot } from "@vipengele/ts-core-common/scope";
import type { RedactionPolicy } from "@vipengele/ts-core-redaction";
import { mergeAttributes } from "../merge-attributes";
import { type RedactionSetting, redactAttributes, redactError } from "../redaction";
import type { ErrorEvent, ExceptionRecord, Mechanism, StackFrame } from "./event";
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

/**
 * A stage between redaction and the transport: it returns the event to pass on, the one it was
 * handed or another, or `null` to drop it. Processors run in the order they were added, each on what
 * the previous one returned, and `beforeSend` runs once after all of them. Each sees the event after
 * redaction. A throw, or a result that is not an object, drops the event silently (ADR-0020).
 */
export type ErrorEventProcessor = (event: ErrorEvent) => ErrorEvent | null;

/** Everything one Reporter's pipeline reads for every event it runs. */
export interface Pipeline {
  readonly clock: Clock;
  readonly transport?: Transport | undefined;
  /** Run in this order, after redaction and before `beforeSend`. */
  readonly processors: readonly ErrorEventProcessor[];
  /** Run once, after every processor and before the transport; absent when none was set. */
  readonly beforeSend?: ErrorEventProcessor | undefined;
  /** What counts as in-app when frames are marked; every frame outside `node_modules` is in-app when absent. */
  readonly projectRoot?: string | undefined;
  /** Applied to every event between enrichment and the processors; no event is redacted when it is `null` or absent. */
  readonly redaction?: RedactionSetting | undefined;
  /**
   * The bounds every event is cut to: attributes and the exception chain through
   * `normalizeAttributes` and `serializeError`, `message` at `maxStringLength`, each link's
   * `frames` at `maxBreadth`. An absent option, or an absent object, takes `serializeError`'s default.
   */
  readonly limits?: Readonly<SerializeErrorOptions> | undefined;
  /**
   * The `deployment.environment.name` values events are sent for, checked before any stage runs.
   * Every environment is enabled when absent.
   */
  readonly enabledEnvironments?: readonly string[] | undefined;
  /**
   * The share of events kept, checked right after the environment gate: an event is kept when
   * `random()` returns less than it. Every event is kept when absent.
   */
  readonly sampleRate?: number | undefined;
  /** The source of the number every event is sampled with, in `[0, 1)`; `Math.random` when absent. */
  readonly random?: (() => number) | undefined;
  /**
   * Matched against every event after normalization and before enrichment; a match drops the event.
   * No event is dropped when absent.
   */
  readonly ignoreErrors?: readonly (string | RegExp)[] | undefined;
}

/** `serializeError`'s default `maxBreadth`, which `frames` take when no `maxBreadth` is set. */
const DEFAULT_MAX_BREADTH = 100;

/** An event after normalization, before enrichment: the payload a caller handed over, and nothing else. */
type NormalizedPayload = Pick<ErrorEvent, "message" | "exception">;

/** Anything that is not one of the six levels becomes `"error"`. */
function toLevel(level: unknown): Level {
  return isLevel(level) ? level : "error";
}

/** Lifts a serialized error to an {@link ExceptionRecord}, giving every link of its `cause`/`errors` chain its own `frames`. */
function toExceptionRecord(serialized: SerializedError, pipeline: Pipeline): ExceptionRecord {
  const { cause, errors, ...rest } = serialized;
  const record: ExceptionRecord = { ...rest, frames: markInApp(boundFrames(parseStack(serialized.stack), pipeline), pipeline.projectRoot) };
  if (cause !== undefined) {
    record.cause = toExceptionRecord(cause, pipeline);
  }
  if (errors !== undefined) {
    record.errors = errors.map((link) => toExceptionRecord(link, pipeline));
  }
  return record;
}

/**
 * The first `maxBreadth` frames, the throw site first, with no marker for the rest: a frame list
 * is read as frames, and a marker entry would be one more frame to a consumer.
 */
function boundFrames(frames: StackFrame[], pipeline: Pipeline): StackFrame[] {
  const maxBreadth = pipeline.limits?.maxBreadth ?? DEFAULT_MAX_BREADTH;
  return frames.length > maxBreadth ? frames.slice(0, maxBreadth) : frames;
}

/**
 * Stage 3: the caller's thrown value or message, in the Error Event's shape. A message longer than
 * `maxStringLength` is cut and suffixed by the same engine, and with the same `"…[truncated]"`
 * marker, as every string inside the attributes and the exception chain.
 */
function normalize(input: CaptureInput, pipeline: Pipeline): NormalizedPayload {
  return input.kind === "exception"
    ? { exception: toExceptionRecord(serializeError(input.error, pipeline.limits), pipeline) }
    : { message: toJsonSafe(input.message, { maxStringLength: pipeline.limits?.maxStringLength }) as string };
}

/**
 * The current Scope's attributes, from the default scope inward, never the Resource. A throw while
 * reading or normalizing them yields an empty record, so the event still goes out with the call's
 * own attributes instead of being dropped.
 */
function scopeAttributes(pipeline: Pipeline): Attributes {
  try {
    return normalizeAttributes(snapshot(Scope.current()), pipeline.limits);
  } catch {
    return {};
  }
}

/** Stage 2: whether the event is inside the sample, drawing one number for it when a `sampleRate` is set. */
function isSampled(pipeline: Pipeline): boolean {
  return pipeline.sampleRate === undefined || (pipeline.random ?? Math.random)() < pipeline.sampleRate;
}

/**
 * Whether `pattern` matches `text`: a string as a substring, a RegExp tested from index 0, so a `g`
 * or `y` flag never carries a position from one test to the next.
 */
function matchesPattern(pattern: string | RegExp, text: string): boolean {
  if (typeof pattern === "string") {
    return text.includes(pattern);
  }
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/**
 * Stage 4: whether any `ignoreErrors` pattern matches the normalized event. An exception is matched
 * through its top exception, the outermost link of the chain, as `"<type>: <message>"` and as its
 * message alone, so a RegExp anchored to the start of the message matches too; a captured message
 * is matched as its text.
 */
function isIgnored(payload: NormalizedPayload, pipeline: Pipeline): boolean {
  const texts =
    payload.exception === undefined
      ? [payload.message as string]
      : [`${payload.exception.type}: ${payload.exception.message}`, payload.exception.message];
  return pipeline.ignoreErrors?.some((pattern) => texts.some((text) => matchesPattern(pattern, text))) === true;
}

/**
 * Stage 5: stamps what the pipeline knows about the event rather than what the caller handed over.
 * The scope's attributes lie beneath the call's own, the call's winning on a shared key, each side
 * normalized on its own so a large scope chain cannot push a call attribute past the breadth bound.
 */
function enrich(payload: NormalizedPayload, input: CaptureInput, mechanism: Mechanism, id: string, pipeline: Pipeline): ErrorEvent {
  return {
    id,
    time: pipeline.clock(),
    level: toLevel(input.level),
    ...payload,
    mechanism,
    attributes: mergeAttributes([scopeAttributes(pipeline), normalizeAttributes(input.attributes ?? {}, pipeline.limits)]),
  };
}

/**
 * The Resource an event is gated on and sent with, read from `Scope.resource()` once per event,
 * before any stage runs. A throw while
 * reading it yields a Resource whose keys are all `undefined`, and the event still goes out:
 * an event is worth more than its Resource. The logger drops a record on the same throw instead.
 */
function eventResource(): Resource {
  try {
    return Scope.resource();
  } catch {
    return Object.freeze({
      "service.name": undefined,
      "service.version": undefined,
      "service.dist": undefined,
      "deployment.environment.name": undefined,
      "process.runtime.name": undefined,
      "process.runtime.version": undefined,
      "os.type": undefined,
      "os.version": undefined,
      "browser.name": undefined,
      "browser.version": undefined,
      "device.type": undefined,
    });
  }
}

/**
 * Whether `resource`'s `deployment.environment.name` is one the pipeline sends events for. Every
 * environment is enabled without an allow-list. With one, an unset environment is enabled, and a set
 * one — the empty string included — only when the list holds it. A `Scope.resource()` that throws
 * reaches here as a Resource with every key unset, so its event is enabled: a Resource that cannot
 * be read says nothing about the environment, and an event is worth more than its Resource.
 */
function isEnvironmentEnabled(resource: Resource, pipeline: Pipeline): boolean {
  const environment = resource["deployment.environment.name"];
  return pipeline.enabledEnvironments === undefined || environment === undefined || pipeline.enabledEnvironments.includes(environment);
}

/**
 * Stage 6, between enrichment and the processors: a copy of `event` whose `attributes`, `mechanism.data`,
 * and every link of its exception chain are redacted by `policy`, the links as the logger redacts
 * a record's error. The event's `message`, and every link's `stack` and `frames`, are kept as they
 * are. A throwing policy throws out of here, and the event is dropped like any stage's.
 */
function redactEvent(event: ErrorEvent, policy: RedactionPolicy): ErrorEvent {
  const redacted: ErrorEvent = { ...event, attributes: redactAttributes(event.attributes, policy) };
  if (event.exception !== undefined) {
    redacted.exception = redactError(event.exception, policy);
  }
  if (event.mechanism.data !== undefined) {
    redacted.mechanism = { ...event.mechanism, data: redactAttributes(event.mechanism.data, policy) };
  }
  return redacted;
}

/** `processor`'s result for `event`, or `null` when it drops the event or returns anything but an object. */
function applyProcessor(processor: ErrorEventProcessor, event: ErrorEvent): ErrorEvent | null {
  const result: unknown = processor(event);
  return typeof result === "object" ? (result as ErrorEvent | null) : null;
}

/**
 * Stage 7: every processor in the order added, each on what the previous one returned. Returns
 * `null`, and runs no processor after it, once one drops the event.
 */
function runProcessors(event: ErrorEvent, pipeline: Pipeline): ErrorEvent | null {
  let current = event;
  for (const processor of pipeline.processors) {
    const next = applyProcessor(processor, current);
    if (next === null) {
      return null;
    }
    current = next;
  }
  return current;
}

/**
 * Runs one event through ADR-0020's stages in order, returning at the first one that drops it.
 * The transport receives `resource` — the Resource the environment gate read, so a
 * `Scope.setResource` made while the event runs through the stages never changes what it is sent
 * with. The step numbers are ADR-0020's; the gaps in them are its stages 9 (deduplication) and
 * 10 (rate limit), which this pipeline does not run.
 */
function run(input: CaptureInput, mechanism: Mechanism, id: string, pipeline: Pipeline): void {
  // Stage 1: the environment gate.
  const resource = eventResource();
  if (!isEnvironmentEnabled(resource, pipeline)) {
    return;
  }
  // Stage 2: sampling.
  if (!isSampled(pipeline)) {
    return;
  }
  // Stage 3: normalize.
  const payload = normalize(input, pipeline);
  // Stage 4: ignoreErrors.
  if (isIgnored(payload, pipeline)) {
    return;
  }
  // Stage 5: enrich.
  const enriched = enrich(payload, input, mechanism, id, pipeline);
  // Stage 6: redaction.
  const policy = pipeline.redaction ?? null;
  const redacted = policy === null ? enriched : redactEvent(enriched, policy);
  // Stage 7: processors.
  const processed = runProcessors(redacted, pipeline);
  if (processed === null) {
    return;
  }
  // Stage 8: beforeSend.
  const sent = pipeline.beforeSend === undefined ? processed : applyProcessor(pipeline.beforeSend, processed);
  if (sent === null) {
    return;
  }
  // Stage 11: the transport.
  pipeline.transport?.send(sent, resource);
}

/**
 * Creates the function every capture goes through — `captureException`, `captureMessage`, and any
 * handler that hands the reporter an error with its own {@link Mechanism}. It reads the Resource
 * once and drops the event before any stage when its environment is not enabled; otherwise it runs
 * sampling, normalize, `ignoreErrors`, enrich, redaction, the processors, `beforeSend` and the
 * transport, in that order. A stage or a `transport.send` that throws drops the event silently, as
 * does an event outside the sample, one an `ignoreErrors` pattern matches, or one a processor or
 * `beforeSend` returns `null` for: the id is returned either way, since a transport is
 * fire-and-forget and the caller learns nothing of delivery (ADR-0010, ADR-0020).
 */
export function createCapture(pipeline: Pipeline): Capture {
  return (input, mechanism) => {
    const id = createEventId();
    try {
      run(input, mechanism, id, pipeline);
    } catch {
      // The event is dropped; a capture never throws.
    }
    return id;
  };
}
