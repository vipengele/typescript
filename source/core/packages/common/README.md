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

## `./scope`

`Scope` is the ambient context tree a log record or an error event reads its attributes from: a
node holds attributes of its own, and `get` walks up to the nearest ancestor holding a key when
the node itself doesn't. The realm has one tree — a root built once from a `Resource` (`service.name`,
`service.version`, `deployment.environment.name`, `process.runtime.name`), and a default scope
beneath it that's current until something propagates a different one.

```ts
import { Scope } from "@vipengele/ts-core-common/scope";

Scope.current().get("requestId"); // undefined outside any propagation

Scope.isolated("http-request", { requestId: "abc" }, () => {
  Scope.current().get("requestId"); // "abc"

  Scope.inherit("db-query", { table: "users" }, () => {
    Scope.current().get("requestId"); // "abc" — inherited from the parent
    Scope.current().get("table"); // "users"
  });
});
```

- `Scope.current()` — the scope installed by the innermost enclosing propagation, or the realm's
  default scope outside any.
- `Scope.propagate(scope, fn)` — calls `fn` with `scope` current, restoring the enclosing scope once
  `fn` returns or throws. `Scope.propagate(fn)`, its 1-argument form, captures the scope current now
  and returns a function that reinstalls it whenever a disconnected callback eventually runs.
- `Scope.inherit(tag, attributes, fn)` — a child of the current scope carrying `tag` and
  `attributes`, current for `fn`.
- `Scope.isolated(tag, attributes, fn)` — a child of the root, not of whatever scope is current: the
  start of a Unit of Work that reads nothing any other Unit of Work's scopes hold, only the root's
  Resource.
- `Scope.useCarrier(carrier)` — replaces the carrier the current scope rides on, seen by every copy
  of the package in the realm from then on.

`isolatedScope(tag)` and `scoped(tag, attributes)` are method decorators wrapping a method's whole
call in `Scope.isolated`/`Scope.inherit` respectively, usable under either the standard decorator
dialect or `experimentalDecorators`.

The root's four Resource keys, and the root scope itself, are reserved: `Scope.current().set(...)`
throws a `ReservedScopeKeyError` when the target is the root, or the key is one the root holds.
Check for it with `isReservedScopeKeyError`, never `instanceof ReservedScopeKeyError`:

```ts
import { isReservedScopeKeyError, Scope } from "@vipengele/ts-core-common/scope";

try {
  Scope.current().set("service.name", "checkout");
} catch (e) {
  if (isReservedScopeKeyError(e)) {
    // "service.name" is a Resource key — every scope refuses to set it.
  }
}
```

## Attributes

`normalizeAttributes` converts arbitrary caller data — a `Date`, a `Map`, an `Error`, an object
with a throwing getter — into an `Attributes` record every sink and transport can serialise as
JSON.

```ts
import { normalizeAttributes } from "@vipengele/ts-core-common/attributes";

normalizeAttributes({ userId: 42, seenAt: new Date() });
// => { userId: 42, seenAt: "2024-01-01T00:00:00.000Z" }
```

The result is bounded (depth, breadth and string length all default to a fixed limit and are
configurable), cycle-safe (an object that contains itself becomes `"[Circular]"` where it
recurs), and never throws — a property that fails to read becomes `"[Unreadable]"` instead of
aborting the whole call.

It is a record-rooted wrapper over the same engine as [`toJsonSafe`](#serialization), which
accepts any value as its root. Its root record is walked as a record — the root's own `toJSON` and
type handling are not applied — and every nested value is converted exactly as `toJsonSafe`
converts it.

## `./serialization`

`toJsonSafe(value, options?)` turns any value — a primitive, a `Date`, a `Map`, an `Error`, a
typed array, an object that contains itself — into a JSON-safe one, bounded in size, and never
throws.

```ts
import { toJsonSafe } from "@vipengele/ts-core-common/serialization";

const order = { id: 9007199254740993n, placedAt: new Date(0), tags: new Set(["a"]), note: undefined };
toJsonSafe(order);
// => { id: "9007199254740993n", placedAt: "1970-01-01T00:00:00.000Z", tags: ["a"] }

toJsonSafe(undefined); // => null
toJsonSafe(new Uint8Array(4)); // => "[Uint8Array: 4 bytes]"
```

`undefined` becomes `null` at the root and as an array element; an object property whose value is
`undefined` is dropped, as `JSON.stringify` does. A value's own `toJSON()` is honored before the
generic handling.

**Bounds** — three options, each defaulting when omitted:

| Option            | Default | Effect                                                                        |
| ----------------- | ------- | ----------------------------------------------------------------------------- |
| `maxDepth`        | 6       | Levels of nesting kept, the input itself counting as the first level.         |
| `maxBreadth`      | 100     | Entries kept per object or array; the rest are summarised by one marker.      |
| `maxStringLength` | 8192    | Characters kept per string; the rest are cut and suffixed with a marker.      |

**Markers** — a value that cannot be represented is replaced by a string that says why:

- `"[Circular]"` — an object that contains itself, where it recurs. The same object appearing twice
  as siblings is not circular and is walked in full both times.
- `"[Truncated]"` — a container nested deeper than `maxDepth`, replaced whole.
- `"[Truncated: N more]"` — the last item of an array, or the value under the `"…"` key of an
  object, when `N` entries beyond `maxBreadth` were dropped.
- `"[Unreadable]"` — a property whose getter throws, or a value that cannot be inspected at all,
  such as a revoked `Proxy`.
- `"…[truncated]"` — the suffix of a string cut at `maxStringLength`.

```ts
toJsonSafe({ a: { b: { c: 1 } } }, { maxDepth: 2 }); // => { a: { b: "[Truncated]" } }
toJsonSafe([1, 2, 3, 4], { maxBreadth: 2 }); // => [1, 2, "[Truncated: 2 more]"]
toJsonSafe("abcdef", { maxStringLength: 3 }); // => "abc…[truncated]"
```

Markers are advisory. An input string that happens to equal a marker is not escaped, so a reader
cannot tell it from the marker the serializer would have produced.

**Binary data** — a typed array, `DataView`, `ArrayBuffer` and `SharedArrayBuffer` are leaves,
described as `"[<ConstructorName>: <byteLength> bytes]"` and never expanded, at any depth. A Node
`Buffer` gives `"[Buffer: N bytes]"`, the same in Node and in the browser.

**Errors** — an `Error` becomes `{ type, message, stack? }`, one level only. Its `cause` and
`errors` are not followed; [`serializeError`](#serializeerror) is what serializes the chain.

### `serializeError`

`serializeError(value)` turns a thrown value and the chain behind it into a `SerializedError`, the
one error shape the logger and the error reporter share (ADR-0007). It never throws.

```ts
import { serializeError } from "@vipengele/ts-core-common/serialization";

const error = Object.assign(new Error("read failed", { cause: new Error("disk offline") }), { code: "EIO", path: "/tmp/a" });
serializeError(error);
// => { type: "Error", message: "read failed", code: "EIO", stack: "…",
//      data: { code: "EIO", path: "/tmp/a" },
//      cause: { type: "Error", message: "disk offline", stack: "…" } }

serializeError("boom"); // => { type: "Error", message: "boom", synthetic: true }
```

- `type`, `message` and `stack` are exactly what `toJsonSafe` gives for the same `Error`.
- `code` is a string `code` property: a `VipengeleError`'s code, or a Node errno code such as
  `"ENOENT"`.
- `data` holds the error's own enumerable properties, normalized as `normalizeAttributes` does.
  `cause` and `errors` are left out of it even when assigned directly, which makes them enumerable.
- `cause`, and every entry of an `errors` array such as an `AggregateError`'s, are serialized in
  turn, up to five links from the outermost error. A link further than that becomes
  `{ type: "[Truncated]", message: "the chain continues past 5 links" }`, and a link back to an
  error already on the path `{ type: "[Circular]", message: "an error already on this chain" }`.
  Beyond the first 100 entries of an `errors` array, one `"[Truncated]"` entry counts the rest.
- A thrown value that is not an `Error` gives `synthetic: true`, typed `Error`, with its JSON-safe
  form as the `message`: a string as it is, anything else as its JSON text.

## Levels

`Level` (`"trace" | "debug" | "info" | "warn" | "error" | "fatal"`) is the severity of a log record
or an error event, and `Threshold` (`Level | "off"`) the lowest one a logger or sink lets through.
Both are types only, exported from the package root.
