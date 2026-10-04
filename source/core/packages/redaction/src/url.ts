import { truncateString } from "./limits";
import { type RedactStringOptions, type ResolvedStringOptions, redactParams, resolveStringOptions } from "./query-string";
import { applyReplacement } from "./replacement";

/**
 * The start of a string that may have an authority: optional leading C0 controls and spaces (which
 * a WHATWG parser strips), an optional scheme and its `:`, then the run of `/` and `\` after it.
 * A WHATWG parser removes every ASCII tab, LF and CR from its input, so the scheme may hold them
 * and the run may hold them between its slashes. Capture 1 is the scheme as written, capture 2 the
 * run.
 */
const AUTHORITY_START = /^[\0-\x20]*(?:([A-Za-z][A-Za-z0-9+.\t\n\r-]*):)?([\t\n\r/\\]*)/;

/** The `//` that opens the authority of a non-special scheme, where `\` is not a slash. */
const DOUBLE_SLASH = /^[\t\n\r]*\/[\t\n\r]*\//;

/**
 * The two separators that open the authority of a scheme-less URL. Each may be `/` or `\`, since a
 * WHATWG parser resolving it against an `http:` or `https:` base reads `\` as a slash.
 */
const SCHEMELESS_DOUBLE_SLASH = /^[\t\n\r]*[/\\][\t\n\r]*[/\\]/;

/** The schemes a WHATWG parser treats as special: they read userinfo after any run of `/` or `\`. */
const SPECIAL_SCHEMES = new Set(["http", "https", "ws", "wss", "ftp", "file"]);

/**
 * The prefix of `url` up to where its authority begins, or `undefined` when it has none. A special
 * scheme (case-insensitive, with any tab, LF or CR removed) is followed by an authority after any
 * run of `/` and `\`, an empty run included, so `https:u:pw@host` and `https:\\u:pw@host` have
 * one, as a WHATWG parser reads them. Any other scheme needs a `//`. A scheme-less string needs two
 * separators, each `/` or `\`, so `\\u:pw@host` and `/\u:pw@host` have an authority, as they do
 * when resolved against a special base. The prefix is returned as written, tabs and newlines
 * included, so those bytes are kept.
 */
function authorityPrefix(url: string): string | undefined {
  // Every part of the pattern is optional, so it matches every string.
  const [whole, scheme, run] = AUTHORITY_START.exec(url) as unknown as [string, string | undefined, string];
  if (scheme !== undefined && SPECIAL_SCHEMES.has(scheme.replace(/[\t\n\r]/g, "").toLowerCase())) {
    return whole;
  }
  const slashes = (scheme === undefined ? SCHEMELESS_DOUBLE_SLASH : DOUBLE_SLASH).exec(run)?.[0];
  return slashes === undefined ? undefined : whole.slice(0, whole.length - run.length) + slashes;
}

/**
 * The index of the `@` that ends the userinfo at the start of `rest`, or -1 when there is none.
 *
 * When `rest` has the `user:pass` shape — a `:` comes before its first `/`, `?` or `#` — the
 * userinfo ends at its first `@`, wherever that is, so a password holding an unencoded `/`, `?` or
 * `#` (`u:p#ss@db`, `u:p/w@h`) is replaced whole. It then extends through every further `@` reached
 * before the next `/`, `?` or `#`, so a raw `@` in a password (`u:p@ss@host`) is replaced too, while
 * an `@` in the path, query or fragment (`u:pw@host/a@b`) is kept. A host with a port and an `@`
 * later on (`host:8080/a@b`, `host:8080?e=a@b`) has the same shape, so everything before that `@`
 * is replaced: the text cannot tell it from a password holding those characters, and over-redacting
 * is the outcome a leak is traded for.
 *
 * Without that shape, the userinfo ends at the last `@` before the first `/`, `?` or `#`, so an `@`
 * in the path, query or fragment of `https://host/p@x` or `https://host?e=a@b` is never userinfo.
 */
function userinfoEnd(rest: string): number {
  const delimiter = rest.search(/[/?#]/);
  const authority = delimiter === -1 ? rest : rest.slice(0, delimiter);
  if (!authority.includes(":")) return authority.lastIndexOf("@");
  const first = rest.indexOf("@");
  if (first === -1) return -1;
  const next = rest.slice(first).search(/[/?#]/);
  return (next === -1 ? rest : rest.slice(0, first + next)).lastIndexOf("@");
}

/**
 * Whether a fragment reads as a parameter list: at least one `&`-separated segment is a
 * `name=value` pair with a non-empty name. `#access_token=x` does; `#section-2` and `#=` do not.
 */
function isParameterFragment(fragment: string): boolean {
  return fragment.split("&").some((segment) => segment.indexOf("=") > 0);
}

/**
 * A URL's userinfo replaced, and how the text after it is read. `head` runs to and includes the
 * userinfo's `@`; `tail` is everything after it.
 *
 * When `userinfoEnd` picks an `@` after a `?` or `#` in `rest`, the URL is read two ways at once,
 * since the text cannot tell which is right: as a password holding that character, in which case
 * `tail` is a host, path, query and fragment as usual, and as a host and port followed by a query
 * or fragment that the `@` sits inside, in which case `tail` continues that query or fragment. Every
 * parameter either reading sees has to reach the policy, so the flags widen the usual reading:
 *
 * - `pathIsParams`: the part of `tail` before its first `?` or `#` is redacted as a parameter list.
 *   Set after a `?` (`host:8080?e=a@b&token=x`), and after a `#` whose fragment, read from that `#`,
 *   is a parameter list (`host:8080#s=a@b&access_token=x`).
 * - `fragmentIsParams`: the fragment of `tail` is redacted as a parameter list even when it does
 *   not read as one on its own. Set in the second case above, where it continues such a fragment.
 *
 * The first `#` before the `@` decides over a `?`, since a `?` after a `#` belongs to the fragment.
 */
interface RedactedUserinfo {
  head: string;
  tail: string;
  pathIsParams: boolean;
  fragmentIsParams: boolean;
}

/**
 * Replaces the userinfo of `url`, or returns `undefined` when there is none to replace.
 *
 * The userinfo is looked for after the authority prefix, in `rest`, and ends at the `@` that
 * `userinfoEnd` picks. A `\` never ends the authority, so a `\` before an `@` widens the userinfo
 * rather than letting part of it through.
 *
 * The username and, when a `:` follows it, the password are both replaced whatever the policy, an
 * empty password included. An empty userinfo (`//@host`) holds nothing to replace and is kept.
 */
function redactUserinfo(url: string, options: ResolvedStringOptions): RedactedUserinfo | undefined {
  const prefix = authorityPrefix(url);
  if (prefix === undefined) return undefined;
  const rest = url.slice(prefix.length);
  const at = userinfoEnd(rest);
  if (at < 1) return undefined;
  const userinfo = rest.slice(0, at);
  const colon = userinfo.indexOf(":");
  const username = colon === -1 ? userinfo : userinfo.slice(0, colon);
  let redacted = String(applyReplacement(options.replacement, username, "username"));
  if (colon !== -1) {
    redacted += `:${String(applyReplacement(options.replacement, userinfo.slice(colon + 1), "password"))}`;
  }
  const hash = userinfo.indexOf("#");
  const fragmentIsParams = hash !== -1 && isParameterFragment(rest.slice(hash + 1));
  return {
    head: `${prefix}${redacted}@`,
    tail: rest.slice(at + 1),
    pathIsParams: fragmentIsParams || (hash === -1 && userinfo.includes("?")),
    fragmentIsParams,
  };
}

/**
 * Returns `url` with its userinfo replaced, and the value of every query and fragment parameter
 * whose name the policy matches replaced. The URL is read as text and never parsed into a `URL`,
 * so relative, scheme-less, protocol-relative and malformed input is accepted, the function never
 * throws on its contents, and every byte outside a replaced part is kept as written.
 *
 * - Userinfo is looked for only when the string has an authority (`scheme://`, two leading
 *   separators each `/` or `\`, or a special scheme such as `https:` followed by any run of `/` and
 *   `\`). Both its parts are
 *   always replaced, whatever the policy; the replacement receives the part as written under the
 *   key `"username"` or `"password"`.
 * - The query runs from the first `?` after the userinfo to the next `#`, and is redacted as
 *   `redactQueryString` redacts one.
 * - The fragment runs from the first `#` after the userinfo to the end. It is redacted the same way
 *   only when it reads as a parameter list, and kept whole otherwise.
 * - When the userinfo's end is ambiguous (`host:8080?e=a@b&token=x`), the text after it is also
 *   redacted as the query or fragment it may continue, so no parameter skips the policy.
 *
 * `maxBreadth` bounds the query and the fragment separately, each keeping up to that many
 * parameters. The redacted result is cut to `maxStringLength` last.
 */
export function redactUrl(url: string, options?: RedactStringOptions): string {
  const resolved = resolveStringOptions(options);
  const userinfo = redactUserinfo(url, resolved);
  const tail = userinfo === undefined ? url : userinfo.tail;
  const hash = tail.indexOf("#");
  const beforeHash = hash === -1 ? tail : tail.slice(0, hash);
  const question = beforeHash.indexOf("?");
  const path = question === -1 ? beforeHash : beforeHash.slice(0, question);

  let result = userinfo === undefined ? path : userinfo.head + (userinfo.pathIsParams ? redactParams(path, resolved) : path);
  if (question !== -1) {
    result += `?${redactParams(beforeHash.slice(question + 1), resolved)}`;
  }
  if (hash !== -1) {
    const fragment = tail.slice(hash + 1);
    const isParams = userinfo?.fragmentIsParams === true || isParameterFragment(fragment);
    result += `#${isParams ? redactParams(fragment, resolved) : fragment}`;
  }
  return truncateString(result, resolved.limits);
}
