# Redact helpers read strings as text, always redact userinfo, and replace whole header values

`@vipengele/ts-core-redaction` exports `redactUrl`, `redactQueryString` and `redactHeaders`, which
redact secrets in transit. All three take the same options as `redact` (`policy`, `replacement`,
`maxStringLength`, `maxBreadth`), default the policy to `secretKeys`, never throw on their input
and never mutate it.

## Strings are read as text

`redactUrl` and `redactQueryString` split the string themselves and never build a `URL` or a
`URLSearchParams`. Every byte outside a replaced value is returned as written, and relative,
scheme-less, protocol-relative and malformed input is accepted.

- A parameter name is percent-decoded, with `+` read as a space, before the policy sees it, so
  `access%5Ftoken=x` is matched as `access_token`.
- A name that cannot be decoded (a malformed `%` escape) is redacted. The policy cannot be asked
  about a name that cannot be read, so the value fails closed.
- The query runs from the first `?` to the first `#`. The fragment is a parameter list, and is
  redacted like a query, only when it contains a `name=value` pair with a non-empty name:
  `#access_token=x` is one, `#section-2` and `#=` are not and are kept whole.

## Userinfo is always redacted

`redactUrl` replaces both parts of the userinfo of every URL that has an authority, whatever the
policy: `https://[REDACTED]:[REDACTED]@host`, and `https://[REDACTED]@host` when there is a
username only. A credential in a URL is not a key a policy names, so no policy is consulted. A
function replacement receives the part under the key `"username"` or `"password"`.

## Header values are replaced whole

A header whose name the policy matches has its entire value replaced. The auth scheme is not kept
and a cookie is not parsed. Each `Set-Cookie` entry is replaced on its own. A `Headers` is read by
iteration, which yields every `Set-Cookie` entry separately, never through `get("set-cookie")`,
which joins the entries with `", "` and so cannot be split back reliably: a cookie's `Expires`
attribute contains a comma. The result is the kind of input given: a `Headers`, a record or
`[name, value]` pairs. Record and pair names keep their casing; a `Headers` yields lower-cased names.

## `redact` is unchanged

`redact`'s walk still returns a `Headers`, a `URL` and a `URLSearchParams` as `{}`, since they hold
their data outside own enumerable properties. The three helpers are how those values are redacted,
and the README names this under Caveats.

## Considered options

- **Parse with `URL` and `URLSearchParams`, and re-serialise.** Re-serialising rewrites `%20` to `+`
  and percent-encodes `~` and `!`, so a redacted URL differs from its input in bytes that held no
  secret. `new URL` throws on a relative or malformed URL, and a parser that normalises it changes
  what the caller logs. Reading the text keeps every untouched byte and has no throwing path.
- **Policy-driven userinfo, matching the keys `username` and `password`.** A custom policy that
  does not list them would leak credentials silently. Redacting userinfo unconditionally makes the
  guarantee independent of the policy.
- **Keep the auth scheme, as in `Bearer [REDACTED]`.** The scheme is rarely needed to debug and
  some values carry a secret in it. Replacing the whole value is the rule that cannot leak.
- **Parse cookies and redact attribute by attribute.** It needs a cookie grammar, and an attribute
  the parser does not recognise would pass through. A matched `Set-Cookie` entry is replaced whole.
- **Read a `Headers` through `get("set-cookie")`.** The joined string cannot be split without
  guessing where one cookie ends. Iteration gives each entry on its own.
- **Teach `redact` to special-case `Headers`, `URL` and `URLSearchParams`.** `redact` takes a key
  policy, and a `Headers` needs header-name matching with `Set-Cookie` entries kept apart, a `URL`
  needs userinfo and a textual query. Folding them into the walk would give it a second set of
  rules, so the dedicated helpers carry them.
