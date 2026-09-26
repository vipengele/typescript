# @vipengele/ts-core-common

Shared types and primitives of the vipengele TypeScript core: context propagation, error
normalization and runtime detection. It exists so the other `@vipengele/ts-core-*` packages agree
on one definition of each; applications rarely import it directly.

```sh
pnpm add @vipengele/ts-core-common
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

## `./context`

`createAsyncContextStore` gives a value a home in the call graph, keyed by a string shared across
every copy of the package in the realm. The store's shape is identical on every runtime; only the
carrier backing it changes, in a fixed fallback order: `AsyncLocalStorage` on Node, then a native
`AsyncContext.Variable`, then a synchronous stack every runtime supports.

```ts
import { createAsyncContextStore } from "@vipengele/ts-core-common/context";

const store = createAsyncContextStore("example", { requestId: "default" });

store.propagate({ requestId: "abc" }, async () => {
  console.log(store.current()); // { requestId: "abc" }
  await somethingAsync();
  console.log(store.current()); // Node: still { requestId: "abc" }. Browser: back to the default.
});
```

The two carriers that follow the runtime's own scheduler (`AsyncLocalStorage`, `AsyncContext`)
keep the value installed across an `await`; the synchronous stack fallback does not, because
nothing about a plain function call tells it when the microtask queue resumed. Both call sites the
sections below cover exist to work around that divergence.

**A disconnected callback** — an event listener, a `setTimeout`, a callback handed to someone
else's `.then` — is a call site you don't control, so you can't wrap it in the 2-argument form of
`propagate`. Its 1-argument form captures the value current right now and returns a function that
reinstalls it whenever the callback eventually runs:

```ts
button.addEventListener("click", store.propagate(() => handleClick()));
```

**Capture-and-rerun** answers the same gap from the other side: a call site you *do* control, in
the browser, where a plain `await` inside one `propagate` call would lose the value. Read
`store.current()` before the gap, and hand it to a fresh `propagate` call after it:

```ts
const captured = store.current();
await somethingAsync();
store.propagate(captured, () => afterTheGap());
```
