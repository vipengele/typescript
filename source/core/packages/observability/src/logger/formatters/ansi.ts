import type { Level, SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import type { Formatter } from "../formatter";
import type { LogRecord } from "../record";

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";

/**
 * The SGR sequence each level's label is written in: grey, cyan, green, yellow, red, and bold
 * bright white on red for `fatal`.
 */
const LEVEL_STYLES: Readonly<Record<Level, string>> = {
  trace: "\u001b[90m",
  debug: "\u001b[36m",
  info: "\u001b[32m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
  fatal: "\u001b[1;97;41m",
};

/** The width of the longest level label, so messages line up across levels. */
const LEVEL_WIDTH = 5;

/** Indentation added for each link of an error chain below the outermost one. */
const INDENT = "  ";

/** `text` in `style`, reset straight after so the style never reaches the next segment. */
function styled(style: string, text: string): string {
  return `${style}${text}${RESET}`;
}

/** Prefixes every line of `text` with `indent`. */
function indented(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

/**
 * The stack without its leading `<type>: <message>` header, which V8 repeats there and the header
 * line already shows. A stack that does not start with the header (Firefox, Safari) is kept whole.
 */
function stackFrames(error: SerializedError, stack: string): string {
  const header = `${error.type}: ${error.message}\n`;
  return stack.startsWith(header) ? stack.slice(header.length) : stack;
}

/**
 * One error and its chain: `<prefix><type>: <message>`, then ` [<code>]` and the compact JSON of
 * `data` when present, then the stack's frames, then the `cause` prefixed `Caused by: ` and each
 * `errors` entry prefixed `errors[<index>]: `, each one {@link INDENT} deeper than its parent.
 * `"[Circular]"` and `"[Truncated]"` entries are rendered like any other error.
 */
function renderError(error: SerializedError, prefix: string, indent: string): string {
  let header = `${prefix}${error.type}: ${error.message}`;
  if (error.code !== undefined) {
    header += ` [${error.code}]`;
  }
  if (error.data !== undefined) {
    header += ` ${JSON.stringify(error.data)}`;
  }
  const lines = [indented(header, indent)];
  if (error.stack !== undefined) {
    lines.push(indented(stackFrames(error, error.stack), indent));
  }
  const nested = indent + INDENT;
  if (error.cause !== undefined) {
    lines.push(renderError(error.cause, "Caused by: ", nested));
  }
  error.errors?.forEach((entry, index) => {
    lines.push(renderError(entry, `errors[${index}]: `, nested));
  });
  return lines.join("\n");
}

/**
 * Formats a record for a colour terminal: the time as dim UTC ISO 8601 text, the level upper-cased
 * and padded in its {@link LEVEL_STYLES} colour, the category in bold, then the message unstyled.
 * Attributes follow as one compact `JSON.stringify` of the attribute object, in its key order, and
 * are left out when there are none. A record's error follows on the next lines with its stack,
 * `cause` chain and `errors` entries. Every styled segment ends in a reset, so no style reaches the
 * message, the attributes or the error. The text is returned behind `"%s"`, so a `%` in user text
 * never reaches the console's format string.
 */
export const ansiFormatter: Formatter = {
  format(record: LogRecord, _resource: Resource): readonly unknown[] {
    const time = styled(DIM, new Date(record.time).toISOString());
    const level = styled(LEVEL_STYLES[record.level], record.level.toUpperCase().padEnd(LEVEL_WIDTH));
    const category = styled(BOLD, record.category);
    let line = `${time} ${level} ${category} ${record.message}`;
    if (Object.keys(record.attributes).length > 0) {
      line += ` ${JSON.stringify(record.attributes)}`;
    }
    if (record.error !== undefined) {
      line += `\n${renderError(record.error, "", INDENT)}`;
    }
    return ["%s", line];
  },
};
