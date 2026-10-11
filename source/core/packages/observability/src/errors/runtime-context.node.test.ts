import { expect, it } from "vitest";
import { detectRuntimeContext } from "./runtime-context";

/** The real `process.version`, read structurally since the package type-checks without `@types/node`. */
const nodeVersion = (globalThis as { process?: { version?: string } }).process?.version;

it("reads Node's runtime name, version and OS type from the real globals", () => {
  const context = detectRuntimeContext();
  expect(context["process.runtime.name"]).toBe("node");
  expect(context["process.runtime.version"]).toMatch(/^\d+\.\d+\.\d+$/);
  expect(context["process.runtime.version"]).toBe(nodeVersion?.replace(/^v/, ""));
  expect(context["os.type"]).toEqual(expect.any(String));
  expect(context).not.toHaveProperty("browser.name");
  expect(context).not.toHaveProperty("os.version");
});
