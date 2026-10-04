// biome-ignore-all lint/security/noSecrets: the URL and query-string fixtures are flagged only for their entropy
import { expect, test } from "vitest";
import {
  awsAccessKey,
  bearerToken,
  composePolicies,
  creditCard,
  email,
  githubToken,
  jwt,
  redact,
  redactHeaders,
  redactQueryString,
  redactUrl,
  secretKeys,
  stripeKey,
  valueDetectors,
  type Detector,
  type HeaderRecord,
  type HeaderTuples,
  type RedactionPolicy,
  type RedactStringOptions,
} from "./index";

test("redacts a value found under a matched key", () => {
  const policy: RedactionPolicy = { keys: ["password"] };

  expect(redact({ username: "alice", password: "hunter2" }, policy)).toStrictEqual({
    username: "alice",
    password: "[REDACTED]",
  });
});

test("redacts credential keys with the secretKeys policy", () => {
  expect(redact({ username: "alice", refresh_token: "abc" }, secretKeys)).toStrictEqual({
    username: "alice",
    refresh_token: "[REDACTED]",
  });
});

test("redacts the keys of every policy passed to composePolicies", () => {
  const policy = composePolicies(secretKeys, { keys: ["ssn"] });

  expect(redact({ ssn: "123", password: "hunter2", name: "alice" }, policy)).toStrictEqual({
    ssn: "[REDACTED]",
    password: "[REDACTED]",
    name: "alice",
  });
});

const MASK = "[REDACTED]";

test("redactUrl redacts userinfo and a matched query parameter", () => {
  expect(redactUrl("//bob:pw@host?token=abc&page=2")).toBe(`//${MASK}:${MASK}@host?token=${MASK}&page=2`);
});

test("redactQueryString redacts a matched parameter under a custom policy", () => {
  const options: RedactStringOptions = { policy: { keys: ["sig"] } };

  expect(redactQueryString("?sig=abc&page=2", options)).toBe(`?sig=${MASK}&page=2`);
});

test("redactHeaders redacts a record, tuples and a Headers", () => {
  const record: HeaderRecord = { Authorization: "b x", Accept: "text/plain" };
  const tuples: HeaderTuples = [["Authorization", "b x"]];

  expect(redactHeaders(record)).toStrictEqual({ Authorization: MASK, Accept: "text/plain" });
  expect(redactHeaders(tuples)).toStrictEqual([["Authorization", MASK]]);
  expect(redactHeaders(new Headers({ Authorization: "b x" })).get("authorization")).toBe(MASK);
});

function expectFrozenDetector(detector: Detector): void {
  expect(Object.isFrozen(detector)).toBe(true);
  expect(detector.pattern).toBeInstanceOf(RegExp);
}

test("jwt is a frozen detector", () => {
  expectFrozenDetector(jwt);
  expect(jwt.pattern.test("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln")).toBe(true);
});

test("bearerToken is a frozen detector", () => {
  expectFrozenDetector(bearerToken);
  expect(bearerToken.pattern.test("Bearer abc.def")).toBe(true);
});

test("creditCard is a frozen detector with a Luhn validator", () => {
  expectFrozenDetector(creditCard);
  expect(creditCard.validate?.("4242 4242 4242 4242")).toBe(true);
  expect(creditCard.validate?.("4242 4242 4242 4243")).toBe(false);
});

test("email is a frozen detector", () => {
  expectFrozenDetector(email);
  expect(email.pattern.test("alice@example.com")).toBe(true);
});

test("awsAccessKey is a frozen detector", () => {
  expectFrozenDetector(awsAccessKey);
  expect(awsAccessKey.pattern.test("AKIAIOSFODNN7EXAMPLE")).toBe(true);
});

test("githubToken is a frozen detector", () => {
  expectFrozenDetector(githubToken);
  expect(githubToken.pattern.test(`ghp_${"a".repeat(36)}`)).toBe(true);
});

test("stripeKey is a frozen detector", () => {
  expectFrozenDetector(stripeKey);
  expect(stripeKey.pattern.test(`sk_live_${"a".repeat(24)}`)).toBe(true);
});

test("valueDetectors is a frozen list of the seven built-in detectors", () => {
  expect(Object.isFrozen(valueDetectors)).toBe(true);
  expect(valueDetectors).toStrictEqual([jwt, bearerToken, creditCard, email, awsAccessKey, githubToken, stripeKey]);
});

test("redacts an email inside a message string with the value detectors", () => {
  const policy = composePolicies(secretKeys, { keys: [], detectors: valueDetectors });

  expect(redact({ message: "contact alice@example.com today" }, policy)).toStrictEqual({
    message: `contact ${MASK} today`,
  });
});

test("exposes exactly the public value exports", async () => {
  const surface = await import("./index");

  expect(Object.keys(surface).sort()).toStrictEqual([
    "awsAccessKey",
    "bearerToken",
    "composePolicies",
    "creditCard",
    "email",
    "githubToken",
    "jwt",
    "redact",
    "redactHeaders",
    "redactQueryString",
    "redactUrl",
    "secretKeys",
    "stripeKey",
    "valueDetectors",
  ]);
});
