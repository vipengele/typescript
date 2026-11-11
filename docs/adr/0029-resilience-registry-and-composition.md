# The resilience registry creates named policies and composes them

`@vipengele/ts-core-resilience` ships five policies, each built by its own factory. This records how
a registry holds named instances of them with layered configuration, how policies nest through
`compose`, and how a realm shares one default registry.

## Context

Nesting policies by hand (a timeout inside a retry's operation) works, but every call site repeats the
wiring, picks its own numbers and creates its own instances, so a breaker for one dependency is not
shared. Applications want one place that names a policy, configures it once and hands back the same
instance, and one function that nests several policies in a fixed, sensible order. `./compose` is
standalone and does not import the registry; `./registry` is the other sub-path. Both are re-exported
from the package root.

## Decisions

1. **Events are a `Listenable`, `registry.events`.** `registry.events: Listenable<ResilienceEvent>`
   matches the `events` every policy already has. `ResilienceEvent` is the union of the five
   policies' events. The registry subscribes to each policy when it creates it, so a listener added
   later still sees events of policies created earlier. Event kinds are disjoint across policies.
   Events carry `name` but not the policy kind, so the registry keys its instances by `(kind, name)`:
   a retry and a timeout may share a name and stay distinct.
2. **A policy's config is layered.** Effective config is the built-in defaults, then every
   `defaults(kind)` layer, then every `configure(kind, name)` layer, then the override of the call
   that creates it. Each step is a shallow merge in call order. A nested object such as
   `slidingWindow` is replaced whole, and a field whose value is `undefined` is skipped, so a field
   inherited from an earlier layer cannot be unset by a later one.
3. **The built-in defaults are resilience4j's numbers**, exported deep-frozen as `builtInDefaults`:
   retry `{ maxAttempts: 3, backoff: fixedBackoff(500) }`; circuit breaker `{ failureRateThreshold: 50,
   slidingWindow: { type: "count", size: 100 }, minimumCalls: 100, waitDurationInOpenMs: 60000,
   permittedCallsInHalfOpen: 10 }`; rate limiter `{ limitForPeriod: 50, refreshPeriodMs: 500,
   maxWaitMs: 5000 }`; timeout `{ durationMs: 1000 }`; bulkhead `{ maxConcurrent: 25 }`. The bulkhead
   default has no queue and no wait, because `maxQueue: 0` with `maxWaitMs: 0` fails the factory.
4. **Validation stays in the factories.** The registry checks only that the kind is known and the name
   is not empty. A `ResilienceConfigError` from a factory is rethrown as a `ResilienceConfigError`
   with the original as `cause`, naming the kind, the name and the layer order, because the failing
   field may come from any layer.
5. **An override applies only to the call that creates the instance.** Any override other than
   `undefined` on an existing `(kind, name)` throws, and nothing is compared: a config holding
   functions (`backoff`, `shouldRetry`, `isFailure`) cannot be compared meaningfully. A call with no
   override returns the existing instance. An instance a pipeline created counts as existing.
6. **`compose(...policies)` nests the first outermost.** Zero policies throws. The result is always a
   fresh wrapper with no `events`, named with the policies' names joined by `" > "`; `compose(p)` is a
   wrapper named `p.name`, not `p`. `options.signal` goes to the outermost policy. Each layer passes
   its `ctx.signal` as the inner policy's `options.signal` and calls the inner `execute`
   synchronously, so a breaker, limiter or bulkhead admits in the same tick as the composed call. The
   operation receives the innermost signal and the attempt of the nearest enclosing policy that
   reports an attempt above 1, else 1. Under nested retries that attempt is neither unique nor
   monotonic (2, 2, 3); this is accepted.
7. **`pipeline(name, { kinds? })` composes in a fixed order**: retry, circuit breaker, rate limiter,
   timeout, bulkhead, outermost first, whatever order `kinds` lists. Without `kinds` it takes the
   kinds that have a `configure` entry for the name or an existing instance of it; a kind-level
   `defaults` entry does not count. An empty `kinds`, a duplicate kind or an unknown kind throws.
   Creation is all-or-nothing: every missing instance is built before any is cached. Each call returns
   a fresh composed policy named `name`.
8. **The builder is a callback.** `createRegistry(build?: (b: RegistryBuilder) => unknown)` ignores the
   return value, which avoids a `| void` in the type. `defaults`, `configure`, `fromConfig`, `clock`
   and `scheduler` chain. The builder is snapshotted when `build` returns and throws on any later use.
   `RegistryBuilderLayer` is the shape a later config parser returns. Factory dispatch is one table
   typed `satisfies { [K in PolicyKind]: ... }`, so there is no fallthrough branch for an unknown kind.
9. **`defaultRegistry(build?)` lives behind a `globalThis` slot**
   (`agentic/rules/shared-realm-state-lives-behind-a-globalthis-symbol-slot.md`), at
   `Symbol.for("vipengele.resilience.registry.v1")`, created lazily inside the call with no
   module-level mutable state. The first call builds with the system clock and scheduler; `clock()` and
   `scheduler()` throw in its builder. A failed first build leaves the slot empty. While that build
   runs the slot holds a `Symbol.for` marker, so a call from inside it, from any copy, throws rather
   than creating a second registry the first then replaces. A later call with
   `build` throws; without one it returns the shared instance. There is no exported reset and no
   exported slot key. The two-copy test imports `default-registry.ts` under a query string, which
   shows the copies agree through the slot; it does not load a second copy of the registry or policy
   code. The `Symbol.for` key and the absence of module-level state carry the guarantee across real
   copies.

## Considered options

- **`registry.on(listener)`**, as the issue proposed. It would be a second subscription shape beside
  `events.on` on every policy, and it could not be typed as the union without `events` anyway.
- **Deep merge of layers.** Two partial sliding windows of different types (`count` and `time`) merge
  into a window that is neither. Whole replacement keeps every nested value one a caller wrote.
- **Treating `undefined` as unsetting a field.** It would make an inherited optional field removable
  but turns an absent value from an options object into a deletion, which callers do not mean.
- **Duplicating validation in the registry.** Two copies of every range check drift, and the factory
  is the only place that knows its own rules.
- **Comparing an override with the existing config**, **silently ignoring it** or **replacing the
  instance.** Comparison is meaningless for function-valued config; ignoring hides a config the
  caller believes is live; replacing breaks the one-instance-per-name guarantee and orphans a breaker's
  state and its listeners.
- **A caller-chosen pipeline order.** Nesting a retry inside a timeout, or a breaker outside a
  retry, changes what each policy counts. A fixed order gives one answer; `compose` remains for a
  different order.
- **An exported reset or slot key for the default registry.** Explicit registries are the primary API,
  and a reset would let any caller drop the realm's shared state.

## Consequences

- One policy per `(kind, name)` is shared by every caller of a registry, so a breaker's window and a
  limiter's permits are common to all its users.
- A configuration mistake surfaces when the policy is first used, not when the registry is built,
  since the factory validates at creation.
- An override is a creating-call tool: a second call with one throws even when it matches.
- A composed policy has no `events`; a listener on `registry.events` sees every created policy's
  events, and a listener on a hand-composed set subscribes to each policy itself.
- The default registry cannot take a clock or scheduler; a test that needs one builds its own with
  `createRegistry`.
