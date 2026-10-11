import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import { OperationTimeoutError, ResilienceConfigError } from "../errors";
import { createEmitter, type Emitter } from "../listenable";
import type { ExecuteOptions, ExecutionContext, Listenable, Policy } from "../types";

/**
 * The largest delay `setTimeout` honours. A larger one overflows and fires almost at once, so a
 * timeout above it is rejected as a configuration error instead of expiring immediately.
 */
export const MAX_TIMEOUT_DURATION_MS = 2_147_483_647;

export interface TimeoutConfig {
  /** How long an attempt may run before it is abandoned; finite, above 0 and at most {@link MAX_TIMEOUT_DURATION_MS}. */
  readonly durationMs: number;
}

export interface TimeoutDeps {
  /** Stamps each {@link TimeoutEvent}'s `at`; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** Supplies the wait the operation is raced against; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
}

/** Emitted when an attempt outlives its duration and is abandoned. */
export interface TimeoutEvent {
  readonly kind: "timeout";
  readonly name: string;
  /** The clock's epoch milliseconds when the attempt was abandoned. */
  readonly at: number;
  readonly durationMs: number;
}

export interface TimeoutPolicy extends Policy {
  readonly events: Listenable<TimeoutEvent>;
}

interface TimeoutSettings {
  readonly name: string;
  readonly durationMs: number;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly emitter: Emitter<TimeoutEvent>;
}

const TIMED_OUT: unique symbol = Symbol("timed-out");

function noop(): void {}

function validate(name: string, config: TimeoutConfig): void {
  if (name === "") {
    throw new ResilienceConfigError("A timeout needs a non-empty name");
  }
  const { durationMs } = config;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_TIMEOUT_DURATION_MS) {
    throw new ResilienceConfigError(
      `Timeout "${name}" expects durationMs to be finite, above 0 and at most ${MAX_TIMEOUT_DURATION_MS}, got ${durationMs}`,
    );
  }
}

function attemptSignal(timer: AbortController, callerSignal: AbortSignal | undefined): AbortSignal {
  return AbortSignal.any(callerSignal === undefined ? [timer.signal] : [callerSignal, timer.signal]);
}

function expire(settings: TimeoutSettings, timer: AbortController): OperationTimeoutError {
  const { name, durationMs } = settings;
  const error = new OperationTimeoutError(`Timeout "${name}" abandoned the operation after ${durationMs}ms`, durationMs);
  timer.abort(error);
  settings.emitter.emit({ kind: "timeout", name, at: settings.clock(), durationMs });
  return error;
}

/**
 * Runs one attempt of `op` against a scheduler sleep of `durationMs`. A caller signal aborted
 * up front rejects with its reason before `op` runs or a sleep starts; one aborted mid-flight
 * reaches `op` through its signal and is not raced here. A synchronous throw from `op` rejects
 * before a sleep starts. Whichever side settles second is abandoned: the sleep is aborted so no
 * timer outlives the attempt, and a late rejection from an abandoned `op` is observed so it is
 * never reported as unhandled.
 */
async function runAttempt<T>(
  settings: TimeoutSettings,
  op: (ctx: ExecutionContext) => Promise<T> | T,
  callerSignal: AbortSignal | undefined,
): Promise<T> {
  callerSignal?.throwIfAborted();
  const timer = new AbortController();
  const pending = Promise.resolve(op({ attempt: 1, signal: attemptSignal(timer, callerSignal) }));
  pending.catch(noop);
  const sleeper = new AbortController();
  const timedOut = settings.scheduler.sleep(settings.durationMs, sleeper.signal).then(() => TIMED_OUT);
  timedOut.catch(noop);
  try {
    const winner = await Promise.race([pending, timedOut]);
    if (winner === TIMED_OUT) {
      throw expire(settings, timer);
    }
    return winner as T;
  } finally {
    sleeper.abort();
  }
}

/**
 * Creates a {@link TimeoutPolicy} that abandons an attempt once it has run for
 * `config.durationMs`: the attempt's signal aborts with an {@link OperationTimeoutError}, the
 * policy emits a `timeout` event and rejects with that same error. Throws a
 * {@link ResilienceConfigError} for an empty `name` or a `durationMs` that is not finite, not
 * above 0 or above {@link MAX_TIMEOUT_DURATION_MS}.
 */
export function createTimeout(name: string, config: TimeoutConfig, deps: TimeoutDeps = {}): TimeoutPolicy {
  validate(name, config);
  const settings: TimeoutSettings = {
    name,
    durationMs: config.durationMs,
    clock: deps.clock ?? systemClock,
    scheduler: deps.scheduler ?? systemScheduler,
    emitter: createEmitter<TimeoutEvent>(),
  };
  return {
    name,
    events: settings.emitter.listenable,
    execute<T>(op: (ctx: ExecutionContext) => Promise<T> | T, options?: ExecuteOptions): Promise<T> {
      return runAttempt(settings, op, options?.signal);
    },
  };
}
