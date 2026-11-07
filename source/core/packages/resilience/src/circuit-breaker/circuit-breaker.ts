import { type Clock, systemClock } from "@vipengele/ts-core-common";
import { CircuitOpenError, isBulkheadFullError, isCircuitOpenError, isRateLimitExceededError } from "../errors";
import { createEmitter, type Emitter } from "../listenable";
import type { ExecuteOptions, ExecutionContext, Listenable, Outcome, Policy } from "../types";
import { type CircuitBreakerConfig, type CircuitBreakerDeps, validateCircuitBreakerConfig } from "./config";
import { createSlidingWindow, type SlidingWindow, type SlidingWindowSnapshot } from "./sliding-window";

export type { CircuitBreakerConfig, CircuitBreakerDeps } from "./config";

/**
 * Where a circuit stands: `"closed"` admits every call, `"open"` refuses every call until its wait
 * elapses, `"half-open"` admits a limited number of probes, and `"forced-open"` refuses every call
 * until `reset()`.
 */
export type CircuitState = "closed" | "open" | "half-open" | "forced-open";

/** Why a circuit moved from one {@link CircuitState} to another. */
export type CircuitStateChangeReason =
  | "failure-rate"
  | "wait-elapsed"
  | "half-open-passed"
  | "half-open-failed"
  | "half-open-timed-out"
  | "reset"
  | "forced-open";

/** A frozen reading of the circuit's counters, all of which restart at 0 on every state transition. */
export interface CircuitBreakerMetrics {
  /**
   * The failure rate over the recorded calls, 0 to 100. `undefined` while a closed circuit holds
   * fewer than `minimumCalls`, while a half-open circuit has recorded fewer than
   * `permittedCallsInHalfOpen` probes, and while the circuit is open or forced open.
   */
  readonly failureRate: number | undefined;
  /** The calls recorded: the sliding window's while closed, the probes' while half-open. */
  readonly bufferedCalls: number;
  /** The recorded calls classified as failures. */
  readonly failedCalls: number;
  /** The recorded calls classified as successes. */
  readonly successfulCalls: number;
  /** The calls refused with a `CircuitOpenError`. */
  readonly notPermittedCalls: number;
  /** The calls that completed but were left out of the failure rate. */
  readonly ignoredCalls: number;
}

/** Emitted after the circuit moved from `from` to `to`. */
export interface CircuitStateChangedEvent {
  readonly kind: "circuit-state-changed";
  readonly name: string;
  /** The clock's epoch milliseconds when the transition happened. */
  readonly at: number;
  readonly from: CircuitState;
  readonly to: CircuitState;
  readonly reason: CircuitStateChangeReason;
}

/** Emitted after the circuit refused a call in `state`. */
export interface CircuitCallNotPermittedEvent {
  readonly kind: "circuit-call-not-permitted";
  readonly name: string;
  /** The clock's epoch milliseconds when the call was refused. */
  readonly at: number;
  readonly state: RefusingState;
}

export type CircuitBreakerEvent = CircuitStateChangedEvent | CircuitCallNotPermittedEvent;

export interface CircuitBreakerPolicy extends Policy {
  readonly events: Listenable<CircuitBreakerEvent>;
  /**
   * The circuit's state as of now. Reading it never transitions and never emits: an open circuit
   * whose wait has elapsed reads `"half-open"`, and a half-open one past `maxWaitInHalfOpenMs`
   * reads `"open"`, but the transition itself happens on the next `execute`.
   */
  readonly state: CircuitState;
  /** A frozen snapshot of the counters of the state the circuit last transitioned into. */
  readonly metrics: CircuitBreakerMetrics;
  /** Moves the circuit to closed with a fresh window and counters; emits only when the state changes. */
  reset(): void;
  /** Moves the circuit to forced-open, refusing every call until `reset()`; a no-op while forced open. */
  forceOpen(): void;
}

type RefusingState = Exclude<CircuitState, "closed">;

interface Breaker {
  readonly name: string;
  readonly failureRateThreshold: number;
  readonly minimumCalls: number;
  readonly waitDurationInOpenMs: number;
  readonly permittedCallsInHalfOpen: number;
  readonly maxWaitInHalfOpenMs: number | undefined;
  readonly isFailure: (outcome: Outcome<unknown>) => boolean;
  readonly clock: Clock;
  readonly emitter: Emitter<CircuitBreakerEvent>;
  /** The closed state's sliding window. */
  readonly window: SlidingWindow;
  /** The half-open state's recorded probe outcomes. */
  readonly probes: SlidingWindow;
  state: CircuitState;
  enteredAt: number;
  /** Bumped on every transition; an outcome admitted under an older generation is stale. */
  generation: number;
  inFlightProbes: number;
  notPermittedCalls: number;
  ignoredCalls: number;
}

function defaultIsFailure(outcome: Outcome<unknown>): boolean {
  return !outcome.ok;
}

/** A clock stepping back reads as no time elapsed, never a negative span. */
function elapsedIn(breaker: Breaker, now: number): number {
  return Math.max(0, now - breaker.enteredAt);
}

function hasElapsed(limitMs: number | undefined, elapsedMs: number): boolean {
  return limitMs !== undefined && elapsedMs >= limitMs;
}

/** The state `now` puts the circuit in, without moving it there. */
function stateAt(breaker: Breaker, now: number): CircuitState {
  const elapsed = elapsedIn(breaker, now);
  if (breaker.state === "open" && hasElapsed(breaker.waitDurationInOpenMs, elapsed)) {
    return "half-open";
  }
  if (breaker.state === "half-open" && hasElapsed(breaker.maxWaitInHalfOpenMs, elapsed)) {
    return "open";
  }
  return breaker.state;
}

function failureRateOf({ buffered, failed }: SlidingWindowSnapshot): number {
  return (failed / buffered) * 100;
}

/**
 * Moves the circuit to `to` at `now`: a new generation makes every outstanding outcome stale, and
 * every counter restarts at 0. The event is emitted once the circuit is already in its new state.
 */
function transition(breaker: Breaker, to: CircuitState, reason: CircuitStateChangeReason, now: number): void {
  const from = breaker.state;
  breaker.state = to;
  breaker.enteredAt = now;
  breaker.generation += 1;
  breaker.window.clear();
  breaker.probes.clear();
  breaker.inFlightProbes = 0;
  breaker.notPermittedCalls = 0;
  breaker.ignoredCalls = 0;
  breaker.emitter.emit({ kind: "circuit-state-changed", name: breaker.name, at: now, from, to, reason });
}

/** Carries out the transition a read of `state` would only report. */
function settleElapsedWait(breaker: Breaker, now: number): void {
  const due = stateAt(breaker, now);
  if (due !== breaker.state) {
    transition(breaker, due, due === "half-open" ? "wait-elapsed" : "half-open-timed-out", now);
  }
}

/** A half-open permit is held by every probe in flight or recorded. */
function takeProbePermit(breaker: Breaker): boolean {
  if (breaker.inFlightProbes + breaker.probes.snapshot().buffered >= breaker.permittedCallsInHalfOpen) {
    return false;
  }
  breaker.inFlightProbes += 1;
  return true;
}

function refuse(breaker: Breaker, state: RefusingState, now: number): CircuitOpenError {
  const { name } = breaker;
  const remainingMs = state === "open" ? Math.max(0, breaker.waitDurationInOpenMs - elapsedIn(breaker, now)) : undefined;
  breaker.notPermittedCalls += 1;
  breaker.emitter.emit({ kind: "circuit-call-not-permitted", name, at: now, state });
  return new CircuitOpenError(`Circuit breaker "${name}" is ${state} and refused the call`, { circuit: name, state, remainingMs });
}

/**
 * Decides synchronously whether a call may run, returning the generation it runs under or throwing
 * the {@link CircuitOpenError} that refuses it.
 */
function admit(breaker: Breaker): number {
  const now = breaker.clock();
  settleElapsedWait(breaker, now);
  const { state } = breaker;
  if (state === "closed" || (state === "half-open" && takeProbePermit(breaker))) {
    return breaker.generation;
  }
  throw refuse(breaker, state, now);
}

/**
 * A caller abort, or a refusal from another policy, says nothing about the protected dependency's
 * health, so neither counts toward the failure rate.
 */
function isIgnored(outcome: Outcome<unknown>, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  return (
    !outcome.ok && (isRateLimitExceededError(outcome.error) || isBulkheadFullError(outcome.error) || isCircuitOpenError(outcome.error))
  );
}

function recordClosed(breaker: Breaker, failed: boolean): void {
  breaker.window.record(failed);
  const snapshot = breaker.window.snapshot();
  if (snapshot.buffered >= breaker.minimumCalls && failureRateOf(snapshot) >= breaker.failureRateThreshold) {
    transition(breaker, "open", "failure-rate", breaker.clock());
  }
}

function recordProbe(breaker: Breaker, failed: boolean): void {
  breaker.inFlightProbes -= 1;
  breaker.probes.record(failed);
  const snapshot = breaker.probes.snapshot();
  if (snapshot.buffered < breaker.permittedCallsInHalfOpen) {
    return;
  }
  if (failureRateOf(snapshot) >= breaker.failureRateThreshold) {
    transition(breaker, "open", "half-open-failed", breaker.clock());
  } else {
    transition(breaker, "closed", "half-open-passed", breaker.clock());
  }
}

function ignore(breaker: Breaker): void {
  breaker.ignoredCalls += 1;
  if (breaker.state === "half-open") {
    breaker.inFlightProbes -= 1;
  }
}

/**
 * Asks the configured `isFailure` how to classify `outcome`. A throwing `isFailure` classifies it
 * as a failure: the outcome is still recorded, so a half-open probe releases its permit, and the
 * throw never replaces the operation's own value or error.
 */
function classify(breaker: Breaker, outcome: Outcome<unknown>): boolean {
  try {
    return breaker.isFailure(outcome);
  } catch {
    return true;
  }
}

/**
 * Records `outcome` against the circuit. An outcome admitted under an older generation is dropped,
 * so a call admitted before a transition never counts toward the state after it. A current
 * generation means the circuit is still in the closed or half-open state that admitted the call.
 */
function complete(breaker: Breaker, generation: number, outcome: Outcome<unknown>, signal: AbortSignal): void {
  if (generation !== breaker.generation) {
    return;
  }
  if (isIgnored(outcome, signal)) {
    ignore(breaker);
    return;
  }
  const failed = classify(breaker, outcome);
  if (breaker.state === "half-open") {
    recordProbe(breaker, failed);
  } else {
    recordClosed(breaker, failed);
  }
}

/** A synchronous throw from `op` is caught like a rejection, so it is an `ok: false` outcome. */
async function attemptOnce<T>(op: (ctx: ExecutionContext) => Promise<T> | T, ctx: ExecutionContext): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await op(ctx) };
  } catch (error) {
    return { ok: false, error };
  }
}

function settle<T>(outcome: Outcome<T>): T {
  if (outcome.ok) {
    return outcome.value;
  }
  throw outcome.error;
}

/**
 * A caller signal aborted up front rejects with its reason before admission and is not counted.
 * Everything up to running `op` happens before the first `await`, so calls made in one
 * synchronous burst are admitted one after another against the permits each leaves behind.
 */
async function run<T>(breaker: Breaker, op: (ctx: ExecutionContext) => Promise<T> | T, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const generation = admit(breaker);
  const outcome = await attemptOnce(op, { attempt: 1, signal });
  complete(breaker, generation, outcome, signal);
  return settle(outcome);
}

function requiredCalls(breaker: Breaker): number | undefined {
  if (breaker.state === "closed") {
    return breaker.minimumCalls;
  }
  return breaker.state === "half-open" ? breaker.permittedCallsInHalfOpen : undefined;
}

function metricsOf(breaker: Breaker): CircuitBreakerMetrics {
  const snapshot = breaker.state === "half-open" ? breaker.probes.snapshot() : breaker.window.snapshot();
  const required = requiredCalls(breaker);
  return Object.freeze({
    failureRate: required === undefined || snapshot.buffered < required ? undefined : failureRateOf(snapshot),
    bufferedCalls: snapshot.buffered,
    failedCalls: snapshot.failed,
    successfulCalls: snapshot.buffered - snapshot.failed,
    notPermittedCalls: breaker.notPermittedCalls,
    ignoredCalls: breaker.ignoredCalls,
  });
}

/** Moves the circuit to closed with a fresh window, counters and generation, even when already closed. */
function resetBreaker(breaker: Breaker): void {
  if (breaker.state !== "closed") {
    transition(breaker, "closed", "reset", breaker.clock());
    return;
  }
  breaker.enteredAt = breaker.clock();
  breaker.generation += 1;
  breaker.window.clear();
  breaker.notPermittedCalls = 0;
  breaker.ignoredCalls = 0;
}

function createBreaker(name: string, config: CircuitBreakerConfig, clock: Clock): Breaker {
  return {
    name,
    failureRateThreshold: config.failureRateThreshold,
    minimumCalls: config.minimumCalls,
    waitDurationInOpenMs: config.waitDurationInOpenMs,
    permittedCallsInHalfOpen: config.permittedCallsInHalfOpen,
    maxWaitInHalfOpenMs: config.maxWaitInHalfOpenMs,
    isFailure: config.isFailure?.bind(config) ?? defaultIsFailure,
    clock,
    emitter: createEmitter<CircuitBreakerEvent>(),
    window: createSlidingWindow(config.slidingWindow, clock),
    probes: createSlidingWindow({ type: "count", size: config.permittedCallsInHalfOpen }, clock),
    state: "closed",
    enteredAt: clock(),
    generation: 0,
    inFlightProbes: 0,
    notPermittedCalls: 0,
    ignoredCalls: 0,
  };
}

/**
 * Creates a {@link CircuitBreakerPolicy} that stops calling a failing dependency. A closed circuit
 * opens once its window holds `minimumCalls` and the failure rate reaches `failureRateThreshold`;
 * an open circuit refuses calls with a {@link CircuitOpenError} for `waitDurationInOpenMs`, then
 * admits `permittedCallsInHalfOpen` probes whose failure rate closes it again or reopens it. The
 * operation's own value or error always reaches the caller unchanged, even when `isFailure` throws;
 * a throwing `isFailure` classifies that outcome as a failure. Throws a
 * `ResilienceConfigError` for an empty `name` or a `config` outside its documented ranges.
 */
export function createCircuitBreaker(name: string, config: CircuitBreakerConfig, deps: CircuitBreakerDeps = {}): CircuitBreakerPolicy {
  validateCircuitBreakerConfig(name, config);
  const breaker = createBreaker(name, config, deps.clock ?? systemClock);
  return {
    name,
    events: breaker.emitter.listenable,
    get state() {
      return stateAt(breaker, breaker.clock());
    },
    get metrics() {
      return metricsOf(breaker);
    },
    reset() {
      resetBreaker(breaker);
    },
    forceOpen() {
      if (breaker.state !== "forced-open") {
        transition(breaker, "forced-open", "forced-open", breaker.clock());
      }
    },
    execute<T>(op: (ctx: ExecutionContext) => Promise<T> | T, options?: ExecuteOptions): Promise<T> {
      return run(breaker, op, options?.signal ?? new AbortController().signal);
    },
  };
}
