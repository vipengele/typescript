import type { Level } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import type { Formatter } from "../formatter";
import type { LogRecord } from "../record";

/** The CSS the time is written in. */
const TIME_STYLE = "color: grey";

/** The CSS the category is written in. */
const CATEGORY_STYLE = "font-weight: bold";

/**
 * The CSS each level's label is written in: grey, teal, green, amber, red, and bold white on red
 * for `fatal`.
 */
const LEVEL_STYLES: Readonly<Record<Level, string>> = {
  trace: "color: grey",
  debug: "color: teal",
  info: "color: green",
  warn: "color: darkorange",
  error: "color: red",
  fatal: "color: white; background: red; font-weight: bold",
};

/**
 * `text` with every `%` doubled, so the console prints it literally instead of reading a directive
 * that would consume or misplace the style arguments.
 */
function escapeDirectives(text: string): string {
  return text.replaceAll("%", "%%");
}

/**
 * Formats a record for a browser DevTools console: a `%c` format string holding the time as UTC
 * ISO 8601 text, the level upper-cased and the category, followed by one CSS argument for each of
 * the three (grey time, the level's {@link LEVEL_STYLES} colour, bold category). Every `%` in the
 * format string is escaped as `%%`, so the three style arguments always line up with the three
 * `%c` directives. The message follows as its own argument and needs no escaping: the console
 * reads directives in the first argument only and prints the rest as they are. The attribute
 * object follows when it has any key, passed as the object itself so DevTools can expand it, and
 * the serialized error comes last when the record has one, so its `cause` chain stays inspectable.
 */
export const browserFormatter: Formatter = {
  format(record: LogRecord, _resource: Resource): readonly unknown[] {
    const time = escapeDirectives(new Date(record.time).toISOString());
    const level = escapeDirectives(record.level.toUpperCase());
    const category = escapeDirectives(record.category);
    const args: unknown[] = [`%c${time} %c${level} %c${category}`, TIME_STYLE, LEVEL_STYLES[record.level], CATEGORY_STYLE, record.message];
    if (Object.keys(record.attributes).length > 0) {
      args.push(record.attributes);
    }
    if (record.error !== undefined) {
      args.push(record.error);
    }
    return args;
  },
};
