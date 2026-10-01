import { resolveAsyncContextVariable, resolveAsyncLocalStorage } from "../context/capabilities";
import { detectRuntime, globalRuntimeSource, type RuntimeSource } from "./identity";

/**
 * A behaviour that differs between runtimes, each detected on its own:
 *
 * - `consoleStyling` — the console renders `%c` CSS directives: browsers, web workers and Deno.
 * - `ansiColour` — standard output renders ANSI colour escapes.
 * - `asyncContext` — the engine offers `AsyncLocalStorage` or `AsyncContext.Variable`. It says a
 *   carrier can be built, not that a value is currently propagating.
 * - `sendBeacon` — `navigator.sendBeacon` can queue a request that outlives the page.
 * - `processExitHooks` — `process.on` can register a handler that runs as the process exits.
 */
export type Capability = "consoleStyling" | "ansiColour" | "asyncContext" | "sendBeacon" | "processExitHooks";

let detected: Partial<Record<Capability, boolean>> = {};

type ProcessSlice = NonNullable<RuntimeSource["process"]>;

/**
 * Reads one environment variable, or `undefined` when it is unset or not a string. A runtime that
 * guards its environment behind a permission (Deno's `process.env` without `--allow-env`) throws on
 * the read, which counts as unset.
 */
function readEnvironment(runtime: ProcessSlice, name: string): string | undefined {
  try {
    const value = runtime.env?.[name];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function supportsConsoleStyling(source: RuntimeSource): boolean {
  const runtime = detectRuntime(source);
  return runtime === "browser" || runtime === "worker" || runtime === "deno";
}

/**
 * A non-empty `NO_COLOR` turns colour off and wins over everything. A `FORCE_COLOR` turns it on,
 * unless it is `"0"` or `"false"`. Otherwise colour follows whether standard output is a terminal
 * whose `TERM` is not `dumb`.
 */
function supportsAnsiColour(source: RuntimeSource): boolean {
  const runtime = source.process;
  if (runtime === undefined) {
    return false;
  }
  const noColor = readEnvironment(runtime, "NO_COLOR");
  if (noColor !== undefined && noColor !== "") {
    return false;
  }
  const forceColor = readEnvironment(runtime, "FORCE_COLOR");
  if (forceColor !== undefined) {
    return forceColor !== "0" && forceColor !== "false";
  }
  return runtime.stdout?.isTTY === true && readEnvironment(runtime, "TERM") !== "dumb";
}

function supportsAsyncContext(source: RuntimeSource): boolean {
  return resolveAsyncLocalStorage(source) !== undefined || resolveAsyncContextVariable(source) !== undefined;
}

function supportsSendBeacon(source: RuntimeSource): boolean {
  return typeof source.navigator?.sendBeacon === "function";
}

/**
 * A bundler's `process` polyfill carries a no-op `on`, so `on` alone proves nothing; requiring
 * `getBuiltinModule` beside it limits the answer to a runtime with a real process behind it.
 */
function supportsProcessExitHooks(source: RuntimeSource): boolean {
  const runtime = source.process;
  return typeof runtime?.getBuiltinModule === "function" && typeof runtime.on === "function";
}

const detectors: Readonly<Record<Capability, (source: RuntimeSource) => boolean>> = {
  consoleStyling: supportsConsoleStyling,
  ansiColour: supportsAnsiColour,
  asyncContext: supportsAsyncContext,
  sendBeacon: supportsSendBeacon,
  processExitHooks: supportsProcessExitHooks,
};

/**
 * Whether the runtime offers `capability`. Without a `source`, each capability is read from
 * `globalThis` the first time it is asked for and memoised on its own for the life of this copy of
 * the module; every copy in a realm reads the same globals, so each computes the same answer. An
 * injected `source` is read afresh on every call and never touches the memo.
 */
export function detectCapability(capability: Capability, source?: RuntimeSource): boolean {
  if (source !== undefined) {
    return detectors[capability](source);
  }
  const answer = detected[capability] ?? detectors[capability](globalRuntimeSource());
  detected[capability] = answer;
  return answer;
}

/** Forgets every memoised capability, so the next {@link detectCapability} without a source reads `globalThis` again. */
export function resetDetectedCapabilities(): void {
  detected = {};
}
