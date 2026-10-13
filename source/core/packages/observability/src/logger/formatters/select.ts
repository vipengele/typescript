import { detectCapability, type RuntimeSource } from "@vipengele/ts-core-common/runtime";
import type { Formatter } from "../formatter";
import { ansiFormatter } from "./ansi";
import { browserFormatter } from "./browser";
import { jsonLinesFormatter } from "./json-lines";

/**
 * The formatter that suits the console of the runtime `source` describes: the browser formatter
 * where the console renders `%c` styling, else the ANSI formatter where standard output renders
 * colour escapes, else JSON lines. Deno offers both capabilities, and styling wins there.
 *
 * An injected `source` is read afresh on every call. Without one, each capability is read from
 * `globalThis` once and memoised by `detectCapability` for the life of that copy of
 * `@vipengele/ts-core-common/runtime`.
 */
export function selectConsoleFormatter(source?: RuntimeSource): Formatter {
  if (detectCapability("consoleStyling", source)) {
    return browserFormatter;
  }
  if (detectCapability("ansiColour", source)) {
    return ansiFormatter;
  }
  return jsonLinesFormatter;
}
