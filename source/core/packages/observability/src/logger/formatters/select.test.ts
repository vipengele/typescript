import { detectCapability, type RuntimeSource } from "@vipengele/ts-core-common/runtime";
import { describe, expect, test } from "vitest";
import { ansiFormatter } from "./ansi";
import { browserFormatter } from "./browser";
import { jsonLinesFormatter } from "./json-lines";
import { selectConsoleFormatter } from "./select";

const nodeVersions = { node: "24.0.0" };

function terminal(env: Record<string, unknown>, isTTY: unknown = true): RuntimeSource {
  return { process: { versions: nodeVersions, env, stdout: { isTTY } } };
}

const browserLike: RuntimeSource = { window: {}, document: {}, navigator: { userAgent: "Mozilla/5.0" } };
const denoLike: RuntimeSource = { Deno: {}, process: { env: {}, stdout: { isTTY: true } } };

describe("selectConsoleFormatter", () => {
  test("picks the browser formatter where the console renders %c", () => {
    expect(selectConsoleFormatter(browserLike)).toBe(browserFormatter);
  });

  test("picks the browser formatter over ANSI where both capabilities hold, as in Deno", () => {
    expect(detectCapability("consoleStyling", denoLike)).toBe(true);
    expect(detectCapability("ansiColour", denoLike)).toBe(true);

    expect(selectConsoleFormatter(denoLike)).toBe(browserFormatter);
  });

  test("picks the ANSI formatter for a Node terminal", () => {
    expect(selectConsoleFormatter(terminal({ TERM: "xterm-256color" }))).toBe(ansiFormatter);
  });

  test("picks JSON lines when NO_COLOR is set on a terminal", () => {
    expect(selectConsoleFormatter(terminal({ NO_COLOR: "1" }))).toBe(jsonLinesFormatter);
  });

  test("picks JSON lines when standard output is piped", () => {
    expect(selectConsoleFormatter(terminal({}, false))).toBe(jsonLinesFormatter);
  });

  test("picks JSON lines for a runtime with neither capability", () => {
    expect(selectConsoleFormatter({})).toBe(jsonLinesFormatter);
  });

  test("reads an injected source afresh on every call", () => {
    const env: Record<string, unknown> = {};
    const source = terminal(env);
    expect(selectConsoleFormatter(source)).toBe(ansiFormatter);

    env.NO_COLOR = "1";

    expect(selectConsoleFormatter(source)).toBe(jsonLinesFormatter);
  });

  test("without a source, picks one of the three formatters from the host and keeps it", () => {
    const selected = selectConsoleFormatter();

    expect([browserFormatter, ansiFormatter, jsonLinesFormatter]).toContain(selected);
    expect(selectConsoleFormatter()).toBe(selected);
  });
});
