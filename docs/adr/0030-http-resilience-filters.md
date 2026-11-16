# The HTTP client wraps resilience policies as filters

`@vipengele/ts-core-http` runs a request through an ordered chain of filters
(`0029-http-client-is-a-fetch-filter-chain.md`), and `@vipengele/ts-core-resilience` holds named
policies in a registry (`0029-resilience-registry-and-composition.md`). This records how the two
meet: which filters exist, how they are built from a registry, what counts as a failure, when a
retry is safe and what happens to a response nobody returns.

## Context

A resilience policy runs an operation and sees its outcome. An HTTP call's outcome is a `Response`
whose status, headers and body decide whether it failed, whether repeating it is safe and how long
to wait, and each attempt needs its own request state. The policies know none of that, and the
filter chain already has bands (`Order`) placed to nest them.

## Decisions

1. **Five filters wrap the five policies, each at its `Order` band.** `retryFilter`,
   `circuitBreakerFilter`, `rateLimiterFilter`, `timeoutFilter` and `bulkheadFilter` sit at
   `RETRY`, `CIRCUIT_BREAKER`, `RATE_LIMITER`, `TIMEOUT` and `BULKHEAD`. That order is the registry
   pipeline's order, so a chain of the five nests the way `registry.pipeline(name)` does.
   *Rejected: one filter wrapping `registry.pipeline()`.* The pipeline is one operation to the
   policies inside it, so no filter can sit below the retry and give each attempt a fresh context,
   and the retry and the breaker could not be given HTTP-aware predicates per call, since those
   need the request's base context.

2. **`resilienceFilters(registry, name, options)` and `builder.resilience(registry, name, options)`
   read the kinds once and resolve the policies at configuration time.** The kinds come from the new
   `ResilienceRegistry.kinds(name, options?)`: those configured or already created for the name, or
   the ones asked for. The policies are fetched through the registry's getters once, so the filters
   share the registry's instances and a request does no lookup. `builder.resilience()` removes every
   filter named after a resilience kind before adding the new set, builds the set before removing
   anything, and throws `HttpConfigError` when no kind exists for the name.
   `kinds()` is a new required member of the exported `ResilienceRegistry` interface. An external
   implementer of the interface breaks; the package is before 1.0 and the break is accepted.
   *Rejected: an optional `kinds()`.* Every caller would need a fallback that guesses the kinds,
   and a guess that disagrees with the registry builds the wrong chain silently.

3. **`RetryPolicy.execute` takes per-call `shouldRetry` and `retryAfter`, and
   `CircuitBreakerPolicy.execute` takes a per-call `isFailure`.** The options are additive and a
   per-call value wins over the policy's own. `maxAttempts`, backoff, the sliding window and the
   thresholds stay owned by the registry's config.
   *Rejected: configuring the HTTP predicates in the registry.* They read the request's base
   context (method, headers, signal, replayability, attributes), which exists only per call, and
   the registry is configured before any request does.

4. **Each retry attempt runs on a fresh context derived from the pristine base.** The retry filter
   keeps the context it receives untouched and, for every attempt including the first, builds a
   context with its own URL and headers and `attempt` set to the policy's attempt number, 1 to n.
   The helper, `createAttemptContext` in `context.ts`, is internal and reads only public
   `HttpContext` fields, so a context from another resolved copy of the package works.
   *Rejected: a chain of `fork()` calls.* A fork of the previous attempt's context carries the
   mutations filters further in made to it, and the attempt number counts forks, which drifts from
   the policy's count when the policy skips or repeats a number.

5. **A failure is a thrown error, a status of 500 or above, 408 or 429 (`defaultIsFailure`).** A
   failing status is a `Response`, not an error, so the retry and the breaker judge the outcome and
   return the `Response` for the status conversion after the chain. `isFailure` replaces the rule
   for both.

6. **`shouldRetry` (`defaultRetryPredicate`) retries a failure only when it is safe, and vetoes
   otherwise.**
   - A refusal from another policy (`CircuitOpenError`, `RateLimitExceededError`,
     `BulkheadFullError`) and any `HttpConfigError` are never retried. The `HttpConfigError` case
     matters most: it is the error a second dispatch of a one-shot body raises
     (`0029-http-client-is-a-fetch-filter-chain.md`), and retrying it cannot succeed.
   - An aborted caller signal and a body that is not replayable end the retries.
   - The method must be idempotent (`GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, `DELETE`), or the call
     opts in through the `RetryNonIdempotent` attribute or carries an `Idempotency-Key` header.
   - An `OperationTimeoutError` is retried like any other failure.

7. **`Retry-After` is honoured up to a cap.** Delta-seconds and an HTTP-date, measured against the
   injected clock and clamped at 0 once past, give the delay. `maxRetryAfterMs`, 30 000 by default,
   caps it: within the cap the delay replaces the backoff, above it the retries end and the caller
   receives that `Response` with its header, so a server asking for a long wait is not hidden
   behind a retry loop. An unparsable header is ignored.

8. **A `Response` is cancelled when it is discarded, never when it is returned.** The retry filter
   cancels the held `Response` when the next attempt starts and when the policy rejects. The
   timeout filter cancels one that arrives after the timeout fired. A `Response` handed back to the
   caller keeps its body.

9. **The timeout filter sets the received context's signal.** While the rest of the chain runs,
   `request.signal` is the policy's composed signal, restored afterwards. Under the retry filter the
   context is the attempt's, so the timeout bounds one attempt; without one it bounds the whole call.

10. **The filters record their state on the shared attributes.** `HttpResilienceAttributes.attempts`
    holds the number of attempts made and `HttpResilienceAttributes.circuitState` the circuit's state
    once the call settled or was refused. The keys are `Symbol.for` symbols, so every resolved copy
    of the package agrees on them, and a filter further out, such as logging, reads them.

11. **Everything is exported from the package root; there is no `./resilience` sub-path.** The
    package is `sideEffects: false`, so a consumer that imports no filter pays for none.
    *Rejected: a `./resilience` sub-path.* Tree-shaking already keeps it out, and a second entry
    point needs a `tsup` entry and an `exports` key kept in step.

12. **`@vipengele/ts-core-http` depends on `@vipengele/ts-core-resilience`.** Both are packages of
    the core project, so the dependency is a `workspace:*` link and needs no cross-project pin
    (`0009-a-cross-project-dependency-is-an-exact-pin-linked-locally.md`). The package still does not depend on
    `@vipengele/ts-core-observability`.

## Consequences

- `HttpClient.builder().resilience(registry, "api")` gives a client the retry, breaker, limiter,
  timeout and bulkhead configured for `"api"`, each behaving the way its policy does elsewhere.
- A call with a non-idempotent method is sent once unless the caller opts in; a status the server
  asks to wait out for longer than the cap reaches the caller as a response.
- A registry implementation outside this repository must add `kinds()`.
- A filter written by a caller sees the attempt contexts the retry builds, so its mutations apply to
  one attempt and are not carried to the next.
