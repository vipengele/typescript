import type { Attributes } from "../attributes/attribute-value";
import { normalizeAttributes } from "../attributes/normalize-attributes";
import { makeErrorLeaf, makeThrownValueLeaf } from "./engine";

/**
 * A thrown value and the chain behind it, in the one shape the logger and the error reporter both
 * carry (ADR-0007). Every field is JSON-safe and bounded.
 */
export interface SerializedError {
  /** The error's constructor name; `"Error"` for a thrown value that is not an `Error`. */
  type: string;
  message: string;
  /** `VipengeleError.code` (ADR-0002), or a Node errno code such as `"ENOENT"`. */
  code?: string;
  /** The raw stack, unparsed. */
  stack?: string;
  /** Present when the thrown value was not an `Error`; its JSON-safe form is the `message`. */
  synthetic?: true;
  /** The error's own enumerable properties, `cause` and `errors` aside. */
  data?: Attributes;
  cause?: SerializedError;
  /** An `AggregateError`'s `errors`. */
  errors?: SerializedError[];
}

/** Links followed from the outermost error, through `cause` or into `errors`, before the chain is cut. */
const MAX_LINKS = 5;
/** Entries of one `errors` array serialized; the rest are summarised by one marker. */
const MAX_ERRORS = 100;

/** Serialized in place of an error that is already on the path from the outermost one. */
const CIRCULAR: SerializedError = { type: "[Circular]", message: "an error already on this chain" };
/** Serialized in place of an error further than {@link MAX_LINKS} links from the outermost one. */
const TRUNCATED: SerializedError = { type: "[Truncated]", message: `the chain continues past ${MAX_LINKS} links` };

/**
 * Own enumerable properties that are part of the chain. The `{ cause }` constructor option
 * defines a non-enumerable `cause`, but `error.cause = x` defines an enumerable one, and taking it
 * into `data` would serialize the same error twice.
 */
const CHAIN_KEYS: ReadonlySet<string> = new Set(["cause", "errors"]);

/** A getter or a `Proxy` trap can throw on any read; a read that throws gives `undefined`. */
function read(target: object, key: string): unknown {
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** `instanceof` throws on a revoked `Proxy`, which then serializes as a thrown non-`Error`. */
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/**
 * The error's own enumerable properties, each read through a getter so that
 * {@link normalizeAttributes} confines a throwing read to its own key. An error whose keys cannot
 * be listed, or that has none outside {@link CHAIN_KEYS}, has no `data`.
 */
function collectData(error: Error): Attributes | undefined {
  let keys: string[];
  try {
    keys = Object.keys(error).filter((key) => !CHAIN_KEYS.has(key));
  } catch {
    return undefined;
  }
  if (keys.length === 0) {
    return undefined;
  }

  const input: Record<string, unknown> = {};
  for (const key of keys) {
    Object.defineProperty(input, key, { enumerable: true, get: () => (error as unknown as Record<string, unknown>)[key] });
  }
  return normalizeAttributes(input);
}

function serializeErrors(errors: readonly unknown[], links: number, path: Set<unknown>): SerializedError[] {
  const result = errors.slice(0, MAX_ERRORS).map((entry) => serializeLink(entry, links, path));
  if (errors.length > MAX_ERRORS) {
    result.push({ type: "[Truncated]", message: `${errors.length - MAX_ERRORS} more errors` });
  }
  return result;
}

function serializeNode(value: unknown, links: number, path: Set<unknown>): SerializedError {
  if (!isError(value)) {
    return { ...makeThrownValueLeaf(value), synthetic: true };
  }

  const serialized: SerializedError = makeErrorLeaf(value);

  const code = read(value, "code");
  if (typeof code === "string") {
    serialized.code = code;
  }

  const data = collectData(value);
  if (data !== undefined) {
    serialized.data = data;
  }

  path.add(value);
  const cause = read(value, "cause");
  if (cause !== undefined) {
    serialized.cause = serializeLink(cause, links + 1, path);
  }
  const errors = read(value, "errors");
  if (Array.isArray(errors)) {
    serialized.errors = serializeErrors(errors, links + 1, path);
  }
  path.delete(value);

  return serialized;
}

/**
 * Only an error on the path from the outermost one is circular; the same error reached twice as
 * siblings is serialized in full both times.
 */
function serializeLink(value: unknown, links: number, path: Set<unknown>): SerializedError {
  if (path.has(value)) {
    return { ...CIRCULAR };
  }
  if (links > MAX_LINKS) {
    return { ...TRUNCATED };
  }
  return serializeNode(value, links, path);
}

/**
 * Serializes a thrown value and the chain behind it, and never throws while doing it.
 *
 * An `Error` gives its `{ type, message, stack? }` as {@link toJsonSafe} does, a string `code`
 * property as `code`, and its own enumerable properties as `data`. Its `cause`, and the entries of
 * an `errors` array such as an `AggregateError`'s, are serialized in turn, up to five links from
 * the outermost error: a link further than that becomes a `"[Truncated]"` entry, and a link back to
 * an error already on the path a `"[Circular]"` one. A thrown value that is not an `Error` gives
 * `synthetic: true`, with its JSON-safe form as the `message`.
 */
export function serializeError(value: unknown): SerializedError {
  return serializeLink(value, 0, new Set());
}
