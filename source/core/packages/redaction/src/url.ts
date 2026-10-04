import { truncateString } from "./limits";
import { type RedactStringOptions, type ResolvedStringOptions, redactParams, resolveStringOptions } from "./query-string";
import { applyReplacement } from "./replacement";

/**
 * The start of a string that has an authority: optional leading C0 controls and spaces (which a
 * WHATWG parser strips), then a scheme followed by `//`, or a bare `//` (protocol-relative). The
 * capture is the prefix up to and including the `//`.
 */
const AUTHORITY_PREFIX = /^([\0-\x20]*(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/)/;

/**
 * Replaces the userinfo of `head` — the URL before its query and fragment — when it has an
 * authority. The authority runs from the `//` to the next `/`; its userinfo is everything before
 * the last `@` in it, so an `@` in the path is never userinfo and an `@` inside a password is. The
 * username and, when a `:` follows it, the password are both replaced whatever the policy, an empty
 * password included. An authority with an empty userinfo (`//@host`) holds nothing to replace and is
 * kept. A `\` does not end the authority, so a `\` before an `@` widens the userinfo rather than
 * letting part of it through.
 */
function redactUserinfo(head: string, options: ResolvedStringOptions): string {
  const prefix = AUTHORITY_PREFIX.exec(head)?.[1];
  if (prefix === undefined) return head;
  const rest = head.slice(prefix.length);
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const at = authority.lastIndexOf("@");
  if (at < 1) return head;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  const username = colon === -1 ? userinfo : userinfo.slice(0, colon);
  let redacted = String(applyReplacement(options.replacement, username, "username"));
  if (colon !== -1) {
    redacted += `:${String(applyReplacement(options.replacement, userinfo.slice(colon + 1), "password"))}`;
  }
  return `${prefix}${redacted}${rest.slice(at)}`;
}

/**
 * Whether a fragment reads as a parameter list: at least one `&`-separated segment is a
 * `name=value` pair with a non-empty name. `#access_token=x` does; `#section-2` and `#=` do not.
 */
function isParameterFragment(fragment: string): boolean {
  return fragment.split("&").some((segment) => segment.indexOf("=") > 0);
}

/**
 * Returns `url` with its userinfo replaced, and the value of every query and fragment parameter
 * whose name the policy matches replaced. The URL is read as text and never parsed into a `URL`,
 * so relative, scheme-less, protocol-relative and malformed input is accepted, the function never
 * throws on its contents, and every byte outside a replaced part is kept as written.
 *
 * - Userinfo is looked for only when the string has an authority (`scheme://` or a leading `//`).
 *   Both its parts are always replaced, whatever the policy; the replacement receives the part as
 *   written under the key `"username"` or `"password"`.
 * - The query runs from the first `?` to the first `#`, and is redacted as `redactQueryString`
 *   redacts one.
 * - The fragment runs from the first `#` to the end. It is redacted the same way only when it
 *   reads as a parameter list, and kept whole otherwise.
 *
 * `maxBreadth` bounds the query and the fragment separately, each keeping up to that many
 * parameters. The redacted result is cut to `maxStringLength` last.
 */
export function redactUrl(url: string, options?: RedactStringOptions): string {
  const resolved = resolveStringOptions(options);
  const hash = url.indexOf("#");
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const question = beforeHash.indexOf("?");
  const head = question === -1 ? beforeHash : beforeHash.slice(0, question);

  let result = redactUserinfo(head, resolved);
  if (question !== -1) {
    result += `?${redactParams(beforeHash.slice(question + 1), resolved)}`;
  }
  if (hash !== -1) {
    const fragment = url.slice(hash + 1);
    result += `#${isParameterFragment(fragment) ? redactParams(fragment, resolved) : fragment}`;
  }
  return truncateString(result, resolved.limits);
}
