// biome-ignore-all lint/security/noSecrets: the redaction fixtures are URL and header strings, flagged only for their entropy
import {
  DateTimeParseError as CoreDateTimeParseError,
  InvalidDateTimeError as CoreInvalidDateTimeError,
  LocalDate as CoreLocalDate,
  LocalDateTime as CoreLocalDateTime,
  LocalTime as CoreLocalTime,
  isDateTimeParseError as coreIsDateTimeParseError,
  isInvalidDateTimeError as coreIsInvalidDateTimeError,
} from "@vipengele/ts-core-common/types/date-time";
import { expect, test } from "vitest";
import type {
  Attributes,
  AttributesInput,
  AttributeValue,
  DateSegment,
  DateSegmentType,
  DateTimeTryParseResult,
  Detector,
  HourCycle,
  IsoDayOfWeek,
  IsoWeekday,
  MaskOptions,
  NameStyle,
  NormalizeAttributesOptions,
  PseudonymizeOptions,
  RedactStringOptions,
} from "./index";
import {
  awsAccessKey,
  bearerToken,
  composePolicies,
  creditCard,
  DateTimeParseError,
  email,
  githubToken,
  InvalidDateTimeError,
  isDateTimeParseError,
  isInvalidDateTimeError,
  jwt,
  LocalDate,
  LocalDateTime,
  Locale,
  LocalTime,
  maskKeepLast,
  Numeric,
  normalizeAttributes,
  pseudonymize,
  redact,
  redactHeaders,
  redactQueryString,
  redactUrl,
  Scope,
  secretKeys,
  stripeKey,
  VipengeleError,
  valueDetectors,
} from "./index";

test("Numeric resolves from @vipengele/ts-core-common and round-trips a number", () => {
  const locale = new Locale("en-US");

  expect(Numeric.parse(Numeric.format(1234.5, locale), locale)).toBe(1234.5);
});

test("Locale resolves from @vipengele/ts-core-common/locale and exposes its calendar conventions", () => {
  const locale = new Locale("en-us");
  const style: NameStyle = "long";
  const firstDay: IsoWeekday = locale.firstDayOfWeek;
  const cycle: HourCycle = locale.hourCycle;

  expect(locale.tag).toBe("en-US");
  expect(firstDay).toBe(7);
  expect(["h11", "h12"]).toContain(cycle);
  expect(locale.monthNames(style)[0]).toBe("January");
});

test("the date-time values are the @vipengele/ts-core-common/types/date-time exports", () => {
  expect(LocalDate).toBe(CoreLocalDate);
  expect(LocalTime).toBe(CoreLocalTime);
  expect(LocalDateTime).toBe(CoreLocalDateTime);
  expect(InvalidDateTimeError).toBe(CoreInvalidDateTimeError);
  expect(DateTimeParseError).toBe(CoreDateTimeParseError);
  expect(isInvalidDateTimeError).toBe(coreIsInvalidDateTimeError);
  expect(isDateTimeParseError).toBe(coreIsDateTimeParseError);
});

test("LocalDate formats and segments a date in a locale", () => {
  const date = LocalDate.of(2026, 2, 3);
  const locale = new Locale("en-US");
  const segments: DateSegment[] = date.segments(locale);
  const types: DateSegmentType[] = segments.map((segment) => segment.type);
  const parsed: DateTimeTryParseResult<LocalDate> = LocalDate.tryParse("2026-02-03");
  const weekday: IsoDayOfWeek = date.dayOfWeek;

  expect(date.format(locale)).toBe("02/03/2026");
  expect(types).toEqual(["month", "literal", "day", "literal", "year"]);
  expect(parsed.success).toBe(true);
  expect(weekday).toBe(2);
});

test("the date-time errors are raised and recognised through the umbrella guards", () => {
  expect(() => LocalDate.of(2026, 2, 30)).toThrow(InvalidDateTimeError);
  expect(isInvalidDateTimeError(captured(() => LocalDate.of(2026, 2, 30)))).toBe(true);
  expect(isDateTimeParseError(captured(() => LocalDate.parse("nope")))).toBe(true);
});

function captured(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

test("redact resolves from @vipengele/ts-core-redaction and redacts a matched key", () => {
  expect(redact({ password: "x" }, { keys: ["password"] })).toEqual({ password: "[REDACTED]" });
});

test("secretKeys resolves from @vipengele/ts-core-redaction and redacts a secret key", () => {
  expect(redact({ password: "x", name: "n" }, secretKeys)).toEqual({ password: "[REDACTED]", name: "n" });
});

test("redactUrl resolves from @vipengele/ts-core-redaction and redacts a matched query parameter", () => {
  const options: RedactStringOptions = { policy: secretKeys };

  expect(redactUrl("https://u:p@h/?token=x", options)).toBe("https://[REDACTED]:[REDACTED]@h/?token=[REDACTED]");
});

test("redactQueryString resolves from @vipengele/ts-core-redaction and redacts a matched query parameter", () => {
  expect(redactQueryString("?token=x&a=1")).toBe("?token=[REDACTED]&a=1");
});

test("redactHeaders resolves from @vipengele/ts-core-redaction and redacts a matched header", () => {
  expect(redactHeaders({ Authorization: "Bearer x", Accept: "a" })).toEqual({ Authorization: "[REDACTED]", Accept: "a" });
});

test("composePolicies resolves from @vipengele/ts-core-redaction and composes policies end to end", () => {
  const policy = composePolicies(secretKeys, { keys: [{ segments: "ssn" }], except: ["tokenCount"] });

  expect(redact({ password: "x", ssn: "1", tokenCount: 3 }, policy)).toEqual({
    password: "[REDACTED]",
    ssn: "[REDACTED]",
    tokenCount: 3,
  });
});

test("valueDetectors resolves from @vipengele/ts-core-redaction and redacts a value inside a string", () => {
  const policy = composePolicies(secretKeys, { keys: [], detectors: valueDetectors });

  expect(redact({ message: "contact alice@example.com today" }, policy)).toEqual({ message: "contact [REDACTED] today" });
});

test("jwt resolves from @vipengele/ts-core-redaction as a detector", () => {
  const detector: Detector = jwt;

  expect(detector.pattern.test(["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "c2ln"].join("."))).toBe(true);
});

test("bearerToken resolves from @vipengele/ts-core-redaction as a detector", () => {
  expect(bearerToken.pattern.test("Bearer abc.def")).toBe(true);
});

test("creditCard resolves from @vipengele/ts-core-redaction as a detector with a validator", () => {
  expect(creditCard.pattern.test("4242 4242 4242 4242")).toBe(true);
  expect(creditCard.validate?.("4242 4242 4242 4242")).toBe(true);
});

test("email resolves from @vipengele/ts-core-redaction as a detector", () => {
  expect(email.pattern.test("alice@example.com")).toBe(true);
});

test("awsAccessKey resolves from @vipengele/ts-core-redaction as a detector", () => {
  expect(awsAccessKey.pattern.test(["AKIA", "IOSFODNN7EXAMPLE"].join(""))).toBe(true);
});

test("githubToken resolves from @vipengele/ts-core-redaction as a detector", () => {
  expect(githubToken.pattern.test(`ghp_${"a".repeat(36)}`)).toBe(true);
});

test("stripeKey resolves from @vipengele/ts-core-redaction as a detector", () => {
  expect(stripeKey.pattern.test(`sk_live_${"a".repeat(24)}`)).toBe(true);
});

test("maskKeepLast resolves from @vipengele/ts-core-redaction and masks all but the last characters", () => {
  const options: MaskOptions = { maskChar: "#" };

  expect(redact({ card: "4242424242424242" }, { keys: ["card"] }, { replacement: maskKeepLast(4) })).toEqual({ card: "**** 4242" });
  expect(redact({ card: "4242424242424242" }, { keys: ["card"] }, { replacement: maskKeepLast(4, options) })).toEqual({
    card: "#### 4242",
  });
});

test("pseudonymize resolves from @vipengele/ts-core-redaction and yields a deterministic token", () => {
  const options: PseudonymizeOptions = { key: "k" };
  const replacement = pseudonymize(options);
  const first = redact({ id: "alice" }, { keys: ["id"] }, { replacement });
  const second = redact({ id: "alice" }, { keys: ["id"] }, { replacement });

  expect(first).toEqual(second);
  expect((first as { id: string }).id).toMatch(/^pseud_[0-9a-f]{16}$/);
});

test("VipengeleError resolves from @vipengele/ts-core-common", () => {
  class TestError extends VipengeleError {
    readonly code = "test_error";
  }

  const error = new TestError("boom");

  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("test_error");
});

test("Scope resolves from @vipengele/ts-core-common/scope and isolates a tagged unit of work", () => {
  expect(Scope.isolated("t", {}, () => Scope.current().tag)).toBe("t");
});

test("normalizeAttributes resolves from @vipengele/ts-core-common and produces an AttributeValue-safe record", () => {
  const input: AttributesInput = { at: new Date(0), name: "value" };
  const options: NormalizeAttributesOptions = { maxDepth: 6 };

  const result: Attributes = normalizeAttributes(input, options);
  const at: AttributeValue | undefined = result.at;

  expect(result).toEqual({ at: "1970-01-01T00:00:00.000Z", name: "value" });
  expect(at).toBe("1970-01-01T00:00:00.000Z");
});
