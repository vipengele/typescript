import type { Attributes } from "../attributes/attribute-value";
import { type NormalizeAttributesOptions, normalizeAttributes } from "../attributes/normalize-attributes";
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

/**
 * Options accepted by {@link serializeError}. The depth, breadth and string length limits bound
 * every link's `message`, `stack` and `data`, and a thrown value's JSON-safe `message`, as
 * {@link NormalizeAttributesOptions} describes.
 */
export interface SerializeErrorOptions extends NormalizeAttributesOptions {
  /**
   * Links followed from the outermost error, through `cause` or into `errors`, before the chain
   * is cut with a `"[Truncated]"` entry. Defaults to 5.
   */
  readonly maxLinks?: number;
  /**
   * Entries of one `errors` array serialized; the rest are summarised by one `"[Truncated]"`
   * entry. Defaults to 100.
   */
  readonly maxErrors?: number;
}

const DEFAULT_MAX_LINKS = 5;
const DEFAULT_MAX_ERRORS = 100;

/** Serialized in place of an error that is already on the path from the outermost one. */
const CIRCULAR: SerializedError = { type: "[Circular]", message: "an error already on this chain" };

/** One call's limits, and the path of errors from the outermost one to the link being serialized. */
interface State {
  readonly options: SerializeErrorOptions | undefined;
  readonly maxLinks: number;
  readonly maxErrors: number;
  /** Serialized in place of an error further than `maxLinks` links from the outermost one. */
  readonly truncated: SerializedError;
  readonly path: Set<unknown>;
}

function createState(options: SerializeErrorOptions | undefined): State {
  const maxLinks = options?.maxLinks ?? DEFAULT_MAX_LINKS;
  return {
    options,
    maxLinks,
    maxErrors: options?.maxErrors ?? DEFAULT_MAX_ERRORS,
    truncated: { type: "[Truncated]", message: `the chain continues past ${maxLinks} links` },
    path: new Set(),
  };
}

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
function collectData(error: Error, options: NormalizeAttributesOptions | undefined): Attributes | undefined {
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
  return normalizeAttributes(input, options);
}

function serializeErrors(errors: readonly unknown[], links: number, state: State): SerializedError[] {
  const result = errors.slice(0, state.maxErrors).map((entry) => serializeLink(entry, links, state));
  if (errors.length > state.maxErrors) {
    result.push({ type: "[Truncated]", message: `${errors.length - state.maxErrors} more errors` });
  }
  return result;
}

function serializeNode(value: unknown, links: number, state: State): SerializedError {
  if (!isError(value)) {
    return { ...makeThrownValueLeaf(value, state.options), synthetic: true };
  }

  const serialized: SerializedError = makeErrorLeaf(value, state.options);

  const code = read(value, "code");
  if (typeof code === "string") {
    serialized.code = code;
  }

  const data = collectData(value, state.options);
  if (data !== undefined) {
    serialized.data = data;
  }

  state.path.add(value);
  const cause = read(value, "cause");
  if (cause !== undefined) {
    serialized.cause = serializeLink(cause, links + 1, state);
  }
  const errors = read(value, "errors");
  if (Array.isArray(errors)) {
    serialized.errors = serializeErrors(errors, links + 1, state);
  }
  state.path.delete(value);

  return serialized;
}

/**
 * Only an error on the path from the outermost one is circular; the same error reached twice as
 * siblings is serialized in full both times.
 */
function serializeLink(value: unknown, links: number, state: State): SerializedError {
  if (state.path.has(value)) {
    return { ...CIRCULAR };
  }
  if (links > state.maxLinks) {
    return { ...state.truncated };
  }
  return serializeNode(value, links, state);
}

/**
 * Serializes a thrown value and the chain behind it, and never throws while doing it.
 *
 * An `Error` gives its `{ type, message, stack? }` as {@link toJsonSafe} does, a string `code`
 * property as `code`, and its own enumerable properties as `data`. Its `cause`, and the entries of
 * an `errors` array such as an `AggregateError`'s, are serialized in turn, up to `maxLinks` links
 * from the outermost error: a link further than that becomes a `"[Truncated]"` entry, and a link
 * back to an error already on the path a `"[Circular]"` one. A thrown value that is not an `Error`
 * gives `synthetic: true`, with its JSON-safe form as the `message`. The limits in
 * {@link SerializeErrorOptions} bound the size of the result.
 */
export function serializeError(value: unknown, options?: SerializeErrorOptions): SerializedError {
  return serializeLink(value, 0, createState(options));
}
