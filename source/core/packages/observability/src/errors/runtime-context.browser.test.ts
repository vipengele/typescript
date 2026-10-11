import { expect, it } from "vitest";
import { detectRuntimeContext } from "./runtime-context";

it("reads Chromium's browser, OS and device from the real navigator", () => {
  const context = detectRuntimeContext();
  expect(context["process.runtime.name"]).toBe("browser");
  expect(context["browser.name"]).toEqual(expect.any(String));
  expect(context["os.type"]).toEqual(expect.any(String));
  expect(context["device.type"]).toEqual(expect.any(String));
  expect(context).not.toHaveProperty("process.runtime.version");
});
