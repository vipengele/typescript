/**
 * The realm slot holding how many {@link suppressBreadcrumbs} calls are running. `Symbol.for` gives
 * every resolved copy of the package the same key, so a call one copy suppresses is suppressed for
 * an instrumentation another copy installed (ADR-0028).
 */
const SUPPRESSED_SLOT = Symbol.for("vipengele:breadcrumbs:suppressed:v1");

type SuppressionRegistry = Record<symbol, number | undefined>;

function registry(): SuppressionRegistry {
  return globalThis as unknown as SuppressionRegistry;
}

/**
 * Runs `fn` synchronously with automatic breadcrumbs suppressed and returns what it returns, a
 * promise included, unchanged. Suppression covers the synchronous call only: an instrumented
 * `fetch` reads {@link breadcrumbsSuppressed} when it is called and carries that answer to its
 * settlement. Calls nest, and a throw from `fn` lifts this call's suppression before it propagates.
 */
export function suppressBreadcrumbs<T>(fn: () => T): T {
  const slots = registry();
  slots[SUPPRESSED_SLOT] = (slots[SUPPRESSED_SLOT] ?? 0) + 1;
  try {
    return fn();
  } finally {
    slots[SUPPRESSED_SLOT] = (slots[SUPPRESSED_SLOT] ?? 1) - 1;
  }
}

/** Whether a {@link suppressBreadcrumbs} call is running in this realm, from any copy of the package. */
export function breadcrumbsSuppressed(): boolean {
  return (registry()[SUPPRESSED_SLOT] ?? 0) > 0;
}
