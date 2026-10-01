/**
 * Where runtime facts are looked up. The real source is `globalThis`; a test passes a plain object
 * instead to force the branch of a runtime the suite does not run in — a web worker, jsdom inside
 * Node, Deno, Bun, an edge runtime, a bundler's `process` polyfill without `getBuiltinModule`.
 *
 * Every member is `unknown` below its name because a runtime, a polyfill or a fake can put anything
 * there; detection checks each one's type before relying on it. The `process` slice is declared
 * structurally because the package type-checks without `@types/node`.
 */
export interface RuntimeSource {
  readonly Deno?: unknown;
  readonly Bun?: unknown;
  readonly EdgeRuntime?: unknown;
  readonly WorkerGlobalScope?: unknown;
  readonly window?: unknown;
  readonly document?: unknown;
  readonly navigator?: { readonly userAgent?: unknown; readonly sendBeacon?: unknown } | undefined;
  readonly process?:
    | {
        readonly getBuiltinModule?: unknown;
        readonly versions?: { readonly node?: unknown } | undefined;
        readonly env?: Readonly<Record<string, unknown>> | undefined;
        readonly stdout?: { readonly isTTY?: unknown } | undefined;
        readonly on?: unknown;
      }
    | undefined;
  readonly AsyncContext?: { readonly Variable?: unknown } | undefined;
}

/** The runtime family code is executing in. `"unknown"` when no check matches. */
export type Runtime = "deno" | "bun" | "edge" | "node" | "worker" | "browser" | "unknown";

/** The user agent Cloudflare Workers reports through `navigator.userAgent`. */
const CLOUDFLARE_WORKERS_USER_AGENT = "Cloudflare-Workers";

export function globalRuntimeSource(): RuntimeSource {
  return globalThis as RuntimeSource;
}

let detectedRuntime: Runtime | undefined;

function isEdge(source: RuntimeSource): boolean {
  const userAgent = source.navigator?.userAgent;
  if (typeof userAgent === "string" && userAgent.startsWith(CLOUDFLARE_WORKERS_USER_AGENT)) {
    return true;
  }
  return source.EdgeRuntime !== undefined;
}

/**
 * The checks run most specific first: Deno and Bun both define a Node-compatible `process`, and an
 * edge runtime with Node compatibility can too, so each is ruled out before `process.versions.node`
 * is trusted. jsdom defines `window` and `document` inside Node, so Node is ruled out before the
 * browser; a web worker has neither, so it is matched by `WorkerGlobalScope`, never by `window`.
 */
function identify(source: RuntimeSource): Runtime {
  if (source.Deno !== undefined) {
    return "deno";
  }
  if (source.Bun !== undefined) {
    return "bun";
  }
  if (isEdge(source)) {
    return "edge";
  }
  if (typeof source.process?.versions?.node === "string") {
    return "node";
  }
  if (source.WorkerGlobalScope !== undefined) {
    return "worker";
  }
  if (source.window !== undefined && source.document !== undefined) {
    return "browser";
  }
  return "unknown";
}

/**
 * The runtime code is executing in. Without a `source`, the answer is read from `globalThis` the
 * first time it is asked for and memoised for the life of this copy of the module; every copy in a
 * realm reads the same globals, so each computes the same answer. An injected `source` is read
 * afresh on every call and never touches the memo.
 */
export function detectRuntime(source?: RuntimeSource): Runtime {
  if (source !== undefined) {
    return identify(source);
  }
  detectedRuntime ??= identify(globalRuntimeSource());
  return detectedRuntime;
}

/** Forgets the memoised runtime, so the next {@link detectRuntime} without a source reads `globalThis` again. */
export function resetDetectedRuntime(): void {
  detectedRuntime = undefined;
}
