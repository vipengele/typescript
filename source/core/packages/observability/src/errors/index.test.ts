import {
  Scope,
  type Resource as CommonResource,
  type ScopeAttributes as CommonScopeAttributes,
  type ScopeUser as CommonScopeUser,
} from "@vipengele/ts-core-common/scope";
import { expect, expectTypeOf, test } from "vitest";
import * as entry from "./index";
import type {
  Resource,
  ScopeAttributes,
  ScopeUser,
  ErrorEvent,
  DropReason,
  ErrorEventProcessor,
  ExitPolicy,
  GlobalErrorEventLike,
  GlobalEventTarget,
  GlobalHandlersOptions,
  GlobalProcess,
  GlobalRejectionEventLike,
  HttpTransportOptions,
  Integration,
  IntegrationCaptureContext,
  IntegrationHost,
  RateLimitOptions,
  ReporterBuilder,
} from "./index";

test("the entry point exports the reporter, the built-in transports and the builder", () => {
  expect(entry.createReporter).toBeTypeOf("function");
  expect(entry.createConsoleTransport).toBeTypeOf("function");
  expect(entry.createHttpTransport).toBeTypeOf("function");
  expect(entry.createTestTransport).toBeTypeOf("function");
  expect(entry.ReporterBuilder).toBeTypeOf("function");
});

test("the entry point exports the reporter's config error and its guard", () => {
  const error = new entry.ReporterConfigError("nope");

  expect(error.code).toBe("observability.errors.config");
  expect(entry.isReporterConfigError(error)).toBe(true);
});

test("the entry point re-exports the shared Scope, not its internal snapshot", () => {
  expect(entry.Scope).toBe(Scope);
  expect(entry.Scope.setResource).toBeTypeOf("function");
  expect(entry.Scope.setUser).toBeTypeOf("function");
  expect(entry.Scope.setTag).toBeTypeOf("function");
  expect(entry.Scope.setContext).toBeTypeOf("function");
  expect("snapshot" in entry).toBe(false);
});

test("the entry point exports the Scope types", () => {
  expectTypeOf<Resource>().toEqualTypeOf<CommonResource>();
  expectTypeOf<ScopeAttributes>().toEqualTypeOf<CommonScopeAttributes>();
  expectTypeOf<ScopeUser>().toEqualTypeOf<CommonScopeUser>();
  expectTypeOf(entry.Scope.setUser).parameter(0).toEqualTypeOf<ScopeUser>();
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
  expectTypeOf<GlobalHandlersOptions["process"]>().toEqualTypeOf<GlobalProcess | undefined>();
  expectTypeOf<GlobalErrorEventLike>().not.toEqualTypeOf<globalThis.ErrorEvent>();
  expectTypeOf<GlobalRejectionEventLike["reason"]>().toEqualTypeOf<unknown>();
});

test("the entry point exports the processor and rate limit types the builder accepts", () => {
  expectTypeOf<ReporterBuilder["addProcessor"]>().parameter(0).toEqualTypeOf<ErrorEventProcessor>();
  expectTypeOf<ReporterBuilder["beforeSend"]>().parameter(0).toEqualTypeOf<ErrorEventProcessor>();
  expectTypeOf<ReporterBuilder["rateLimit"]>().parameter(0).toEqualTypeOf<false | RateLimitOptions>();
  expectTypeOf<ErrorEventProcessor>().toEqualTypeOf<(event: ErrorEvent) => ErrorEvent | null>();
});

test("the entry point exports the HTTP transport's config error, guard and types", () => {
  const error = new entry.HttpTransportConfigError("nope");

  expect(error.code).toBe("observability.errors.http-transport.config");
  expect(entry.isHttpTransportConfigError(error)).toBe(true);
  expectTypeOf(entry.createHttpTransport).parameter(0).toEqualTypeOf<HttpTransportOptions>();
  expectTypeOf<DropReason>().toEqualTypeOf<"queue-full" | "too-large" | "retries-exhausted" | "rejected" | "unsendable" | "closed">();
});
