import type { SerializedError } from "@vipengele/ts-core-common";
import type { KeyValue } from "./any-value";

const EXCEPTION_TYPE = "exception.type";
const EXCEPTION_MESSAGE = "exception.message";
const EXCEPTION_STACKTRACE = "exception.stacktrace";

/** The attribute keys {@link exceptionAttributes} writes. */
export const EXCEPTION_KEYS: ReadonlySet<string> = new Set([EXCEPTION_TYPE, EXCEPTION_MESSAGE, EXCEPTION_STACKTRACE]);

/** A V8 stack frame line; the lines before the first one are V8's own `name: message` header. */
const V8_FRAME = /^\s+at /;

/**
 * The `exception.*` attributes of an error chain: `exception.type` and `exception.message` from the
 * outermost error, `exception.stacktrace` the whole chain as {@link exceptionStacktrace} lays it out.
 */
export function exceptionAttributes(error: SerializedError): KeyValue[] {
  return [
    { key: EXCEPTION_TYPE, value: { stringValue: error.type } },
    { key: EXCEPTION_MESSAGE, value: { stringValue: error.message } },
    { key: EXCEPTION_STACKTRACE, value: { stringValue: exceptionStacktrace(error) } },
  ];
}

/**
 * An error chain as text in the JVM's layout (ADR-0007): each error is a `type: message` header line
 * (`type` alone for an empty message) followed by its stack frames; the errors of an
 * `AggregateError` follow as `Suppressed:` blocks indented one tab, each with its own chain inside
 * it; the `cause` follows as a `Caused by:` block at the same depth.
 *
 * A V8 stack opens with its own `name: message` header, which is dropped in favour of the error's
 * header so the message is not written twice; a stack with no V8 frame that starts with the header
 * loses that prefix, and any other stack (SpiderMonkey's and JavaScriptCore's carry no header) is
 * kept whole. Blank lines are dropped.
 */
export function exceptionStacktrace(error: SerializedError): string {
  return chainLines(error).join("\n");
}

function chainLines(error: SerializedError): string[] {
  const header = error.message === "" ? error.type : `${error.type}: ${error.message}`;
  const lines = [header, ...frameLines(error.stack, header)];
  for (const suppressed of error.errors ?? []) {
    const [first, ...rest] = chainLines(suppressed);
    lines.push(`\tSuppressed: ${first}`, ...rest.map((line) => `\t${line}`));
  }
  if (error.cause !== undefined) {
    const [first, ...rest] = chainLines(error.cause);
    lines.push(`Caused by: ${first}`, ...rest);
  }
  return lines;
}

function frameLines(stack: string | undefined, header: string): string[] {
  if (stack === undefined) {
    return [];
  }
  let lines = stack.split("\n");
  const firstFrame = lines.findIndex((line) => V8_FRAME.test(line));
  if (firstFrame >= 0) {
    lines = lines.slice(firstFrame);
  } else if (stack.startsWith(header)) {
    lines = stack.slice(header.length).split("\n");
  }
  return lines.filter((line) => line.trim() !== "");
}
