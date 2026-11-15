# @vipengele/ts-core-resilience

Resilience primitives for the browser and Node: timeouts, retries, circuit breaking, rate limiting, bulkheads and the typed errors they raise.

| Entry point | What it holds |
|-------------|---------------|
| `@vipengele/ts-core-resilience/circuit-breaker` | `createCircuitBreaker`, the `CircuitBreakerPolicy`, its metrics and events |
| `@vipengele/ts-core-resilience/timeout` | `createTimeout`, the `TimeoutPolicy` and its events |
| `@vipengele/ts-core-resilience/retry` | `createRetry`, the backoff strategies and the `RetryPolicy` and its events |
| `@vipengele/ts-core-resilience/rate-limiter` | `createRateLimiter`, the `RateLimiterPolicy`, its config, deps and events |
| `@vipengele/ts-core-resilience/bulkhead` | `createBulkhead`, the `BulkheadPolicy`, its config, deps and events |
| `@vipengele/ts-core-resilience/compose` | `compose`, which nests policies into one |
| `@vipengele/ts-core-resilience/registry` | `createRegistry`, `defaultRegistry`, `builtInDefaults` and the registry types |
| `@vipengele/ts-core-resilience/errors` | The errors the package raises, with their guards |
| `@vipengele/ts-core-resilience` | All of the above |

```sh
pnpm add @vipengele/ts-core-resilience
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

## Policies

A policy has a `name` and `execute(op, options?)`. `op` receives `{ attempt, signal }` (`attempt` is
1-based) and may return a value or a promise; `execute` returns a promise of the same value.
`options.signal` is the caller's `AbortSignal`.

## `./timeout`

```ts
import { createTimeout } from "@vipengele/ts-core-resilience/timeout";

const timeout = createTimeout("profile.fetch", { durationMs: 2_000 });

const response = await timeout.execute(({ signal }) => fetch("https://example.com/profile", { signal }));
```

The attempt is abandoned once it has run for `durationMs` (finite, above 0, at most
`MAX_TIMEOUT_DURATION_MS`). The policy then rejects with an `OperationTimeoutError` and aborts `signal`
with that same error. The operation has to pass `signal` on to whatever it awaits: a timeout stops
waiting for work that ignores `signal`, it cannot stop the work. The signal also aborts when the
caller's `options.signal` does.

`events` reports each abandoned attempt:

```ts
const unsubscribe = timeout.events.on((event) => {
  console.warn(`${event.name} timed out after ${event.durationMs} ms`); // event.kind === "timeout"
});

unsubscribe();
```

## `./retry`

```ts
import { createRetry, exponentialBackoff, withJitter } from "@vipengele/ts-core-resilience/retry";

const retry = createRetry("profile.fetch", {
  maxAttempts: 4,
  backoff: withJitter(exponentialBackoff({ initialMs: 100, maxMs: 5_000 }), "full"),
});

const profile = await retry.execute(async ({ attempt, signal }) => {
  const response = await fetch(`https://example.com/profile?attempt=${attempt}`, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
});
```

`maxAttempts` counts the first attempt. After a failed attempt the policy waits for `backoff` (given
the 1-based number of the attempt that just failed) and runs `op` again. The error of the last attempt
is rethrown as the very value `op` threw.

- **Backoff** — `fixedBackoff(ms)`, `exponentialBackoff({ initialMs, multiplier = 2, maxMs? })` and
  `withJitter(strategy, "full" | "equal")`. A bad number throws `ResilienceConfigError` where it is
  written.
- **`shouldRetry(outcome, attempt)`** — an `Outcome` is `{ ok: true, value }` or
  `{ ok: false, error }`. The default retries every error, `OperationTimeoutError` included, except
  `CircuitOpenError`, `RateLimitExceededError` and `BulkheadFullError`, and never retries an `ok`
  outcome.
- **`retryAfter(outcome, attempt)`** — a delay in milliseconds that overrides `backoff`; return
  `undefined` to fall back to it.
- **Abort** — `execute(op, { signal })` checks the signal before the first attempt and after each
  failed one, and cuts the wait between attempts short. Each rejects with the signal's reason.

```ts
const controller = new AbortController();
const result = retry.execute(({ signal }) => fetch("https://example.com/profile", { signal }), {
  signal: controller.signal,
});
controller.abort();
```

`events` reports what the policy decided:

```ts
retry.events.on((event) => {
  if (event.kind === "retry") {
    console.warn(`${event.name}: attempt ${event.attempt} failed, retrying in ${event.delayMs} ms`);
  } else {
    console.error(`${event.name}: gave up after ${event.attempts} attempts`); // "retry-exhausted"
  }
});
```

`retry-exhausted` is emitted only when `shouldRetry` wanted another attempt and none was left.

## `./circuit-breaker`

```ts
import { createCircuitBreaker } from "@vipengele/ts-core-resilience/circuit-breaker";

const breaker = createCircuitBreaker("profile.api", {
  failureRateThreshold: 50,
  slidingWindow: { type: "count", size: 20 },
  minimumCalls: 10,
  waitDurationInOpenMs: 30_000,
  permittedCallsInHalfOpen: 3,
});

const response = await breaker.execute(({ signal }) => fetch("https://example.com/profile", { signal }));
```

The breaker stops calling a dependency that keeps failing. `execute` runs `op` once (`attempt` is
always 1) and returns its value or rethrows its error unchanged. While the circuit refuses calls,
`execute` rejects with a `CircuitOpenError` without running `op`; the message reads
`Circuit breaker "<name>" is <state> and refused the call`.

Config, validated at creation (a bad value throws `ResilienceConfigError`):

- **`failureRateThreshold`** — a percentage, finite, above 0 and at most 100. The circuit opens when
  the failure rate reaches it.
- **`slidingWindow`** — `{ type: "count", size }` measures the last `size` calls (an integer of at
  least 1). `{ type: "time", size }` measures the last `size` milliseconds (finite, above 0, at most
  2147483647) in about 100 aggregated buckets, so the window edge is accurate to one bucket and memory
  stays bounded whatever the throughput. A clock reading earlier than the newest bucket lands in that
  bucket and evicts nothing.
- **`minimumCalls`** — an integer of at least 1: the calls a closed circuit needs in its window before
  it may open. A count window smaller than `minimumCalls` is rejected, since the circuit could never
  open.
- **`waitDurationInOpenMs`** — finite, above 0, at most 2147483647: how long an open circuit refuses
  calls.
- **`permittedCallsInHalfOpen`** — an integer of at least 1: the probes a half-open circuit admits.
- **`maxWaitInHalfOpenMs`** — optional, same range as the open wait: how long a half-open circuit
  waits for its probes. Unset waits indefinitely.
- **`isFailure(outcome)`** — decides whether an outcome counts as a failure. The default is
  `!outcome.ok`; a custom one also sees `ok: true` outcomes. If it throws, the outcome counts as a
  failure and the caller still gets the operation's own value or error.

`deps` takes a `clock` (default `systemClock`); the breaker never sleeps, so it takes no scheduler.

### States

- **`closed`** admits every call and records each outcome. After recording, the circuit opens
  (`failure-rate`) when the window holds at least `minimumCalls` and the failure rate is at or above
  the threshold.
- **`open`** refuses every call for `waitDurationInOpenMs`. The `CircuitOpenError` carries
  `remainingMs`, the time left, never below 0.
- **`half-open`** admits up to `permittedCallsInHalfOpen` calls, counting those still in flight; the
  rest are refused. Once that many probe outcomes are recorded, the failure rate over just those
  decides: below the threshold closes the circuit with a fresh window (`half-open-passed`), at or above
  reopens it for another full wait (`half-open-failed`). `minimumCalls` does not apply. With
  `maxWaitInHalfOpenMs` set, a half-open circuit still waiting for probes when it elapses opens
  again (`half-open-timed-out`).
- **`forced-open`** refuses every call until `reset()`. `forceOpen()` enters it and is a no-op while
  already forced open.

`reset()` moves the circuit to closed from any state with a fresh window and counters, and emits only
when the state changes. In `closed` it still clears the window and counters.

### Transitions are lazy

There is no timer. `breaker.state` reads `"half-open"` once the open wait has elapsed, and `"open"`
once a half-open circuit is past `maxWaitInHalfOpenMs`, but the transition itself, and its
`circuit-state-changed` event, happen on the next `execute`. After the open wait, that call is
admitted as the first probe. After the half-open deadline, that call moves the circuit to `open`, is
refused, and starts the new wait. A read (`state`, `metrics`) never transitions and never emits.

Between the wait elapsing and the next call, `state` reads `"half-open"` while `metrics` still holds
the open period's counters, because counters reset only on the transition.

### Ignored and stale outcomes

A call is ignored, not recorded, when the caller's signal is aborted by the time it completes or when
its error is a `RateLimitExceededError`, `BulkheadFullError` or `CircuitOpenError` (another policy's
refusal says nothing about this dependency). An ignored call releases its half-open permit and counts
in `ignoredCalls`. A signal that is already aborted rejects with its reason before admission and is not
counted at all. A synchronous throw from `op` is an `ok: false` outcome.

Every transition makes the calls admitted before it stale. A stale outcome is recorded nowhere, though
its value or error still reaches the caller.

### Metrics

`breaker.metrics` is a frozen snapshot per read: `failureRate` (0 to 100), `bufferedCalls`,
`failedCalls`, `successfulCalls`, `notPermittedCalls` and `ignoredCalls`. `failureRate` is
`undefined` while closed below `minimumCalls`, while half-open until all permitted probes have
recorded, and while open or forced-open. Every counter restarts at 0 on every state transition,
`reset()` and `forceOpen()` included.

### Events

```ts
breaker.events.on((event) => {
  if (event.kind === "circuit-state-changed") {
    console.warn(`${event.name}: ${event.from} -> ${event.to} (${event.reason})`);
  } else {
    console.warn(`${event.name}: refused a call while ${event.state}`); // "circuit-call-not-permitted"
  }
});
```

`circuit-state-changed` carries `from`, `to` and a `reason`: `failure-rate`, `wait-elapsed`,
`half-open-passed`, `half-open-failed`, `half-open-timed-out`, `reset` or `forced-open`.
`circuit-call-not-permitted` carries the `state` that refused the call. Both carry `name` and `at`, and
are emitted after the state has changed. There is no per-call success or failure event.

### With retry

Put the breaker inside the retry's operation so each attempt is checked against the circuit. The default
`shouldRetry` declines a `CircuitOpenError`, so an open circuit ends the retries at once:

```ts
const profile = await retry.execute((ctx) =>
  breaker.execute(({ signal }) => fetch("https://example.com/profile", { signal }).then((r) => r.json()), {
    signal: ctx.signal,
  }),
);
```

## `./rate-limiter`

```ts
import { createRateLimiter } from "@vipengele/ts-core-resilience/rate-limiter";

const limiter = createRateLimiter("profile.api", {
  limitForPeriod: 10,
  refreshPeriodMs: 1_000,
  maxWaitMs: 500,
  burst: 20,
});

const response = await limiter.execute(({ signal }) => fetch("https://example.com/profile", { signal }));
```

The limiter starts with `limitForPeriod` permits. `execute` takes one, runs `op` once (`attempt` is
always 1) and returns its value or rethrows its error unchanged.

Config, validated at creation (a bad value throws `ResilienceConfigError`):

- **`limitForPeriod`** — an integer of at least 1: the permits each refresh period adds.
- **`refreshPeriodMs`** — finite, above 0, at most `MAX_TIMEOUT_DURATION_MS`: the length of a period.
- **`burst`** — optional, an integer of at least `limitForPeriod`, which is also the default: the most
  permits unused periods may save up. At the default each period resets the free permits to
  `limitForPeriod`.
- **`maxWaitMs`** — required, finite, at least 0, at most `MAX_TIMEOUT_DURATION_MS`: how long `execute`
  may wait for a permit. `0` fails fast.

`deps` takes a `clock` (default `systemClock`) and a `scheduler` (default `systemScheduler`).

The config is a `RateLimiterConfig` and `deps` a `RateLimiterDeps`. `createRateLimiter` returns a
`RateLimiterPolicy`: a policy plus `events` and `tryAcquire`. `events` reports `RateLimiterEvent`s, the
union of `RateLimitExceededEvent` and `RateLimitWaitedEvent`.

Periods are counted in whole periods from creation on the clock, and a passed period adds
`limitForPeriod` permits up to `burst`. A clock stepping back adds nothing, and the forward step that
follows does not refill twice.

When no permit is free, the limiter works out how long until one is. Within `maxWaitMs` it reserves the
permit and sleeps, using the caller's `signal`; calls are served in arrival order. Beyond `maxWaitMs`
it rejects at once with a `RateLimitExceededError` whose `retryAfterMs` is that wait, reserving nothing.
Aborting a waiting call rejects with the signal's reason and returns its permit. A call waiting behind
it keeps its due time, so the refund benefits later arrivals only, and a period can briefly see more
calls than `burst`.

`tryAcquire(permits = 1)` takes permits at once if that many are free and returns whether it did. It
never waits, never takes permits a waiting call has reserved and emits nothing. It returns `false` for
more permits than `burst` and throws a `RangeError` when `permits` is not an integer of at least 1.

```ts
limiter.events.on((event) => {
  if (event.kind === "rate-limit-exceeded") {
    console.warn(`${event.name}: refused, retry in ${event.retryAfterMs} ms`);
  } else {
    console.warn(`${event.name}: waited ${event.waitMs} ms`); // "rate-limit-waited"
  }
});
```

A `RateLimitExceededEvent` (`rate-limit-exceeded`) carries `permits` and `retryAfterMs`; a
`RateLimitWaitedEvent` (`rate-limit-waited`) carries `permits` and
`waitMs`, the wait planned when the permits were reserved. Both carry `name` and `at`.

## `./bulkhead`

```ts
import { createBulkhead } from "@vipengele/ts-core-resilience/bulkhead";

const bulkhead = createBulkhead("profile.db", { maxConcurrent: 5, maxQueue: 10, maxWaitMs: 1_000 });

const rows = await bulkhead.execute(({ signal }) => query({ signal }));
```

The bulkhead runs at most `maxConcurrent` calls at once. `execute` runs `op` once (`attempt` is always
1) and returns its value or rethrows its error unchanged. `bulkhead.available` is `maxConcurrent` minus
the calls running now.

Config, validated at creation (a bad value throws `ResilienceConfigError`):

- **`maxConcurrent`** — an integer of at least 1.
- **`maxQueue`** — optional, an integer of at least 0, default 0: the calls that may wait for a permit.
  `maxQueue: 0` fails fast.
- **`maxWaitMs`** — optional, finite, above 0, at most `MAX_TIMEOUT_DURATION_MS`: how long a queued call
  waits. Unset, it waits until it gets a permit or its signal aborts. Setting it while `maxQueue` is 0
  is rejected.

`deps` takes a `clock` (default `systemClock`) and a `scheduler` (default `systemScheduler`).

The config is a `BulkheadConfig` and `deps` a `BulkheadDeps`. `createBulkhead` returns a
`BulkheadPolicy`: a policy plus `events` and `available`. `events` reports `BulkheadEvent`s, which are
`BulkheadRejectedEvent`s.

A running call holds its permit until `op` settles, whether it resolves, rejects or throws
synchronously. Aborting the caller's signal does not release it, so `maxConcurrent` is a true limit;
the bulkhead never aborts a signal itself. A released permit goes to the oldest queued call.

A call that finds every permit taken and the queue full rejects with a `BulkheadFullError` with reason
`"full"`. A queued call whose `maxWaitMs` elapses rejects with reason `"wait-timeout"`. A queued call
whose signal aborts leaves the queue and rejects with the signal's reason, emitting no event.

```ts
bulkhead.events.on((event) => {
  console.warn(`${event.name}: refused a call (${event.reason})`); // event.kind === "bulkhead-rejected"
});
```

A `BulkheadRejectedEvent` carries `name`, `at` and the `reason`, `"full"` or `"wait-timeout"`.

## Timeout and retry together

A timeout inside the retry's operation bounds each attempt, and the default `shouldRetry` retries the
resulting `OperationTimeoutError`. `compose` nests the policies for you:

```ts
import { compose } from "@vipengele/ts-core-resilience/compose";

const perAttempt = createTimeout("profile.attempt", { durationMs: 2_000 });

const guarded = compose(retry, perAttempt);

const body = await guarded.execute(({ signal }) => fetch("https://example.com/profile", { signal }).then((r) => r.text()));
```

Nesting the calls by hand is the same thing:

```ts
const body = await retry.execute((ctx) =>
  perAttempt.execute(({ signal }) => fetch("https://example.com/profile", { signal }).then((r) => r.text()), {
    signal: ctx.signal,
  }),
);
```

A registry builds the same nesting from configuration:

```ts
import { createRegistry } from "@vipengele/ts-core-resilience/registry";

const registry = createRegistry((b) =>
  b
    .configure("retry", "profile", { maxAttempts: 4 })
    .configure("timeout", "profile", { durationMs: 2_000 }),
);

const body = await registry
  .pipeline("profile")
  .execute(({ signal }) => fetch("https://example.com/profile", { signal }).then((r) => r.text()));
```

## `./compose`

`compose(...policies)` returns one `Policy` with the first policy outermost; no policies throws a
`ResilienceConfigError`. The result is always a fresh wrapper named with the policies' names joined by
`" > "` (`compose(p)` is a wrapper named `p.name`), and it has no `events`: each policy keeps its own.

`options.signal` goes to the outermost policy, and each layer hands its own signal to the next as the
caller's signal, so an abort reaches the operation through every layer. The next layer's `execute` is
called synchronously, so a breaker, limiter or bulkhead admits in the same tick as the composed call.
The operation receives the innermost policy's signal and the attempt of the nearest enclosing policy
that reports an attempt above 1, else 1. Under nested retries that attempt is neither unique nor
monotonic (2, 2, 3).

`./compose` does not import the registry.

## `./registry`

```ts
import { createRegistry } from "@vipengele/ts-core-resilience/registry";

const registry = createRegistry((b) =>
  b
    .defaults("timeout", { durationMs: 5_000 })
    .configure("circuitBreaker", "profile.api", { slidingWindow: { type: "count", size: 20 }, minimumCalls: 10 })
    .clock(clock)
    .scheduler(scheduler),
);

const breaker = registry.circuitBreaker("profile.api");
const retry = registry.retry("profile.api", { maxAttempts: 5 });

registry.events.on((event) => console.warn(event.kind, event.name));
```

`registry.retry`, `circuitBreaker`, `rateLimiter`, `timeout` and `bulkhead` return the policy of that
kind called `name`, creating it on first use; there is one instance per kind and name, and policies of
different kinds may share a name. A name that is empty throws a `ResilienceConfigError`.

- **Layers** — a policy's config is the built-in defaults, then each `defaults(kind, config)` layer,
  then each `configure(kind, name, config)` layer, then the override passed to the creating call. Each
  step is a shallow merge in call order: a nested object such as `slidingWindow` is replaced whole, and
  a field set to `undefined` is skipped, so it cannot unset an inherited one. `fromConfig(layer)` adds a
  `RegistryBuilderLayer` (`{ defaults?, configure? }`) the same way.
- **Validation** — the factories validate. A `ResilienceConfigError` from one is rethrown as a
  `ResilienceConfigError` naming the kind, the name and the layer order, with the original as `cause`.
- **Overrides** — any override other than `undefined` for an existing kind and name throws, whatever it
  holds. A call without one returns the existing instance. An instance a pipeline created counts as
  existing.
- **Builder** — `createRegistry(build?)` ignores `build`'s return value. The builder's `defaults`,
  `configure`, `fromConfig`, `clock` and `scheduler` chain, and any use after `build` returns throws.
- **`events`** — a `Listenable<ResilienceEvent>`, the union of the five policies' events, covering
  every policy the registry created, whenever the listener was added.

### `pipeline`

`registry.pipeline(name, { kinds? })` composes the policies called `name` into one policy named `name`,
outermost first in the fixed order retry, circuit breaker, rate limiter, timeout, bulkhead, whatever
order `kinds` lists. Without `kinds` it takes every kind that has a `configure` entry for `name` or an
existing instance called `name`; a `defaults` entry does not count, and a name with neither throws. An
empty, duplicated or unknown `kinds` throws. Missing instances are created from their effective config
with no override, all or none. Each call returns a new composed policy over the shared instances.

### `builtInDefaults`

Deep-frozen, resilience4j's numbers: retry `{ maxAttempts: 3, backoff: fixedBackoff(500) }`; circuit
breaker `{ failureRateThreshold: 50, slidingWindow: { type: "count", size: 100 }, minimumCalls: 100,
waitDurationInOpenMs: 60000, permittedCallsInHalfOpen: 10 }`; rate limiter `{ limitForPeriod: 50,
refreshPeriodMs: 500, maxWaitMs: 5000 }`; timeout `{ durationMs: 1000 }`; bulkhead
`{ maxConcurrent: 25 }`, with no queue and no wait.

### `defaultRegistry`

```ts
import { defaultRegistry } from "@vipengele/ts-core-resilience/registry";

defaultRegistry((b) => b.configure("timeout", "profile", { durationMs: 2_000 }));

const timeout = defaultRegistry().timeout("profile");
```

One registry per realm, held at `globalThis[Symbol.for("vipengele.resilience.registry.v1")]` and
created by the first call, so every resolved copy of the package shares it. It runs on the system clock
and scheduler: `clock()` and `scheduler()` throw in its builder. A first `build` that throws leaves
nothing created, and a `defaultRegistry` call from inside that `build` throws. Once it exists, a call with `build` throws and a call without returns it. A test that
needs its own clock or configuration uses `createRegistry`.

## Errors

`@vipengele/ts-core-resilience/errors` (also re-exported from the package root) holds the errors the
package raises. Each extends the abstract `ResilienceError`, carries a fixed `code`, and has a paired
type-guard. Check an error with the guard, never `instanceof`: two resolved copies of the package give
the same source two class identities, and the guard compares `code`.

| Error | Code | Guard |
|-------|------|-------|
| `CircuitOpenError` | `resilience.circuit-open` | `isCircuitOpenError` |
| `RateLimitExceededError` | `resilience.rate-limit-exceeded` | `isRateLimitExceededError` |
| `BulkheadFullError` | `resilience.bulkhead-full` | `isBulkheadFullError` |
| `OperationTimeoutError` | `resilience.timeout` | `isOperationTimeoutError` |
| `ResilienceConfigError` | `resilience.config` | `isResilienceConfigError` |

`isResilienceError` matches any error whose `code` starts with `resilience.`.

```ts
import { isOperationTimeoutError } from "@vipengele/ts-core-resilience/errors";

try {
  await work();
} catch (error) {
  if (isOperationTimeoutError(error)) {
    console.warn(`gave up after ${error.durationMs} ms`);
  }
}
```

`CircuitOpenError` carries `circuit` (the breaker's name), `state` (`"open"`, `"half-open"` or
`"forced-open"`) and `remainingMs` (milliseconds until half-open, set only for `"open"`).

`RateLimitExceededError` carries `limiter` (the limiter's name), `permits` (what the refused call asked
for) and `retryAfterMs` (milliseconds until the permits are available), which maps to an HTTP
`Retry-After`. Its message reads `Rate limiter "<name>" refused the call: its permit is free in
<retryAfterMs>ms, beyond the <maxWaitMs>ms it may wait`.

`BulkheadFullError` carries `bulkhead` (the bulkhead's name) and `reason`: `"full"` or
`"wait-timeout"`. Its message reads `Bulkhead "<name>" refused the call: all <maxConcurrent> permits are
taken and its queue of <maxQueue> is full` for `"full"` and `Bulkhead "<name>" refused the call: no
permit came free within the <maxWaitMs>ms it may wait` for `"wait-timeout"`.

`OperationTimeoutError` takes `(message, durationMs, options?)`. `CircuitOpenError`,
`RateLimitExceededError` and `BulkheadFullError` take `(message, details, options?)` with `details`
`{ circuit, state, remainingMs? }`, `{ limiter, permits, retryAfterMs }` and `{ bulkhead, reason }`
respectively; `ResilienceConfigError` takes `(message, options?)`, where `options` is the standard
`ErrorOptions` (`cause`).
