import type { Threshold } from "@vipengele/ts-core-common";
import { parseSpec } from "./spec";

/** The environment variable an operator sets a level spec in (ADR-0005). */
export const ENVIRONMENT_VARIABLE = "VPG_LOG";

/**
 * Where {@link readEnvironmentSpec} looks for `process.env`: `globalThis` unless a test injects
 * another. Every part is optional, since a browser has no `process` and a bundler's polyfill may
 * have no `env`.
 */
export interface EnvironmentSource {
  readonly process?: { readonly env?: Readonly<Record<string, unknown>> | undefined } | undefined;
}

/**
 * The raw value of `VPG_LOG` in `source`'s `process.env`, or `undefined` when there is no
 * `process.env`, the variable is unset or not a string, or reading it throws: a runtime that guards
 * its environment behind a permission (Deno without `--allow-env`) throws on the read. Never throws.
 */
export function readEnvironmentSpec(source: EnvironmentSource = globalThis as EnvironmentSource): string | undefined {
  try {
    const value = source.process?.env?.[ENVIRONMENT_VARIABLE];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The outcome of {@link parseEnvironmentSpec}: the levels of the environment layer and its issues. */
export interface EnvironmentLevels {
  readonly levels: Readonly<Record<string, Threshold>>;
  readonly issues: readonly string[];
}

/**
 * Parses `spec`, the raw value of `VPG_LOG`, through `parseSpec`, prefixing each issue with the
 * variable's name so a warning says where the bad entry came from. Never throws.
 */
export function parseEnvironmentSpec(spec: string): EnvironmentLevels {
  const parsed = parseSpec(spec);
  return { levels: parsed.levels, issues: parsed.issues.map((issue) => `${ENVIRONMENT_VARIABLE}: ${issue}`) };
}
