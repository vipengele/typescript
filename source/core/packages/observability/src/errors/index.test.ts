import { expect, expectTypeOf, test } from "vitest";
import * as entry from "./index";
import type { ErrorEvent, Integration, IntegrationCaptureContext, IntegrationHost, ReporterBuilder } from "./index";

test("the entry point exports the reporter, the built-in transports and the builder", () => {
  expect(entry.createReporter).toBeTypeOf("function");
  expect(entry.createConsoleTransport).toBeTypeOf("function");
  expect(entry.createTestTransport).toBeTypeOf("function");
  expect(entry.ReporterBuilder).toBeTypeOf("function");
});

test("the exported ErrorEvent is the framework's type, not the DOM one", () => {
  expectTypeOf<ErrorEvent>().not.toEqualTypeOf<globalThis.ErrorEvent>();
});

test("the entry point exports the integration contract the builder accepts", () => {
  expectTypeOf<ReporterBuilder["add"]>().parameter(0).toEqualTypeOf<Integration>();
  expectTypeOf<Integration["setup"]>().parameter(0).toEqualTypeOf<IntegrationHost>();
  expectTypeOf<IntegrationHost["capture"]>().parameter(1).toEqualTypeOf<IntegrationCaptureContext>();
});
