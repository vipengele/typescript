---
about: "every fetch or console call the observability package makes runs inside suppressBreadcrumbs, or autoBreadcrumbs records the package's own traffic"
saw:
  - source/core/packages/observability/src/breadcrumb-suppression.ts
  - source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/fetch.ts
  - source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/console.ts
  - source/core/packages/observability/src/delivery/delivery.ts
  - source/core/packages/observability/src/delivery/offline/offline-queue.ts
  - source/core/packages/observability/src/errors/transports/http/request.ts
---
Transports, sinks and warnings look up `globalThis.fetch` / `console` at call time, so once `autoBreadcrumbs` patches them the
package's own delivery and console output would land in the trail. Each invocation is wrapped as
`suppressBreadcrumbs(() => <call>)` (`breadcrumb-suppression.ts`, a counter in the `Symbol.for("vipengele:breadcrumbs:suppressed:v1")`
slot). Wrap the call expression, not the capture: the `defaultFetch` fallbacks (`delivery.ts`, `offline-queue.ts`) are captures and
stay unwrapped. Suppression covers the synchronous call only; the fetch and XHR wrappers read it when the request starts
(`fetch.ts` `begin`, `xhr.ts` at `send`) and carry the answer to settlement. Easy to miss: `delivery.ts`'s unload keepalive
in `#sendKeepalive` and `offline-queue.ts`'s replay in `#send` are both real fetch calls. ADR-0028 decision 5.
