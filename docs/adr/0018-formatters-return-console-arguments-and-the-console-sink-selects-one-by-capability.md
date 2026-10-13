# Formatters return console arguments and the console sink selects one by capability

A `Formatter` is `{ format(record, resource): readonly unknown[] }`: the argument list of one
console call. `createConsoleSink({ formatter?, console?, source? })` owns the level-to-method
routing of ADR-0007 (`error` and `fatal` to `error`, `warn` to `warn`, `info` to `info`, `trace` and
`debug` to `debug`) and calls `console[method](...formatter.format(record, resource))`. With no
`formatter`, it reads `detectCapability` once at creation: `consoleStyling` gives the browser
formatter, else `ansiColour` gives the ANSI formatter, else JSON lines. An explicit `formatter`
always wins.

## Why an argument list

- A formatter that returns a string cannot give a browser console the `%c` style arguments or an
  attribute object DevTools can expand.
- A formatter that returns `{ method, args }` would route per formatter, so three formatters would
  carry three copies of the level table. With the sink routing, there is one rule for every
  formatter, including a consumer's.
- Formatters stay pure functions of a record and a Resource, testable with no console.

The first argument is a console format string. A formatter returns user text behind `"%s"` (JSON
lines, ANSI) or escapes `%` as `%%` in the format string it builds (browser); a message such as
`disk 95%d full` would otherwise be mangled or swallow the next argument.

## Selection bundles all three formatters

ADR-0004 lists formatters among the "separate classes a consumer passes in, not code the default
path references". Capability-based selection makes `createConsoleSink` reference all three
statically, so a consumer who imports it bundles them. This is accepted: they are small, and the
logger's default path (`emit`, `Logging`) references none of them, so a consumer who never imports
`createConsoleSink` sheds all three.

## Time

JSON lines keeps `time` as the record's numeric epoch milliseconds, sub-millisecond fraction
included, because ADR-0007 keeps the fraction so records written within one millisecond stay
ordered and `toISOString()` drops it. The ANSI and browser formatters are for reading and render UTC
ISO 8601 text, so their output does not depend on the host time zone.

## Considered options

- **Formatters returning a string.** Loses `%c` styling and inspectable objects in a browser.
- **Formatters returning `{ method, args }`.** Duplicates the routing in every formatter.
- **`console.log` for `info`, or `console.trace` for `trace`.** `log` would not separate `info`
  from the rest in DevTools' level filter, and `trace` prints a stack on every call. The routing
  matches the errors console transport.
- **Forcing the formatter by hand only.** The runtime already reports what its console renders, and
  a default that suits the runtime is what `createConsoleSink()` is for.

## Consequences

- A stdout or stream sink cannot consume console-argument lists. It will need a different,
  string-only contract, not this one.
- The logger keeps its own copy of the routing table, as the `./logger` and `./errors` entry points
  do not import each other; ADR-0007 is the authority for both.
