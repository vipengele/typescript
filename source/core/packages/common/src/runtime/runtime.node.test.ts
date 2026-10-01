import { afterEach, expect, test } from "vitest";
import { detectCapability, detectRuntime } from "./index";
import { resetDetectedCapabilities } from "./capabilities";
import { resetDetectedRuntime } from "./identity";

afterEach(() => {
  resetDetectedRuntime();
  resetDetectedCapabilities();
});

test("Node identifies as node", () => {
  expect(detectRuntime()).toBe("node");
});

test("Node offers async context and exit hooks, but neither %c nor sendBeacon", () => {
  expect(detectCapability("asyncContext")).toBe(true);
  expect(detectCapability("processExitHooks")).toBe(true);
  expect(detectCapability("consoleStyling")).toBe(false);
  expect(detectCapability("sendBeacon")).toBe(false);
});
