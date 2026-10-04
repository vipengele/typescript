// biome-ignore-all lint/security/noSecrets: the URL and query-string fixtures are flagged only for their entropy
import { expect, test } from "vitest";
import {
  composePolicies,
  redact,
  redactHeaders,
  redactQueryString,
  redactUrl,
  secretKeys,
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

test("exposes exactly the public value exports", async () => {
  const surface = await import("./index");

  expect(Object.keys(surface).sort()).toStrictEqual([
    "composePolicies",
    "redact",
    "redactHeaders",
    "redactQueryString",
    "redactUrl",
    "secretKeys",
  ]);
});
