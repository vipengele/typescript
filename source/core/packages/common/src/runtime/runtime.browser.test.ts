import { afterEach, expect, test } from "vitest";
import { detectCapability, detectRuntime } from "./index";
import { resetDetectedCapabilities } from "./capabilities";
import { resetDetectedRuntime } from "./identity";

afterEach(() => {
  resetDetectedRuntime();
  resetDetectedCapabilities();
});

test("Chromium identifies as browser", () => {
  expect(detectRuntime()).toBe("browser");
});

test("Chromium offers %c and sendBeacon, but neither ANSI colour nor exit hooks", () => {
  expect(detectCapability("consoleStyling")).toBe(true);
  expect(detectCapability("sendBeacon")).toBe(true);
  expect(detectCapability("ansiColour")).toBe(false);
  expect(detectCapability("processExitHooks")).toBe(false);
});
