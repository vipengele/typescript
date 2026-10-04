import { expect, expectTypeOf, test } from "vitest";
import * as entry from "./index";
import type {
  ErrorEvent,
  ExitPolicy,
  GlobalErrorEventLike,
  GlobalEventTarget,
  GlobalHandlersOptions,
  GlobalRejectionEventLike,
  Integration,
  IntegrationCaptureContext,
  IntegrationHost,
  ReporterBuilder,
} from "./index";

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

test("the entry point exports the globalHandlers integration and its options", () => {
  expect(entry.globalHandlers).toBeTypeOf("function");
  expectTypeOf(entry.globalHandlers).parameter(0).toEqualTypeOf<GlobalHandlersOptions>();
  expectTypeOf(entry.globalHandlers).returns.toEqualTypeOf<Integration>();
  expectTypeOf<GlobalHandlersOptions["onUncaught"]>().toEqualTypeOf<ExitPolicy>();
  expectTypeOf<GlobalHandlersOptions["eventTarget"]>().toEqualTypeOf<GlobalEventTarget | undefined>();
  expectTypeOf<GlobalErrorEventLike>().not.toEqualTypeOf<globalThis.ErrorEvent>();
  expectTypeOf<GlobalRejectionEventLike["reason"]>().toEqualTypeOf<unknown>();
});
