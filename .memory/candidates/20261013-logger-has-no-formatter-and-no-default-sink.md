---
about: the logger's default build has no sink; console output is opt-in through createConsoleSink, whose Formatter returns console arguments and whose sink owns level routing
saw:
  - source/core/packages/observability/src/logger/settings.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/console-sink.ts
  - source/core/packages/observability/src/logger/formatter.ts
  - source/core/packages/observability/src/logger/record.ts
  - docs/adr/0018-formatters-return-console-arguments-and-the-console-sink-selects-one-by-capability.md
---
- No default sink: the default build has `sinks: []` (`settings.ts:70-74`), so a record that passes the level check goes nowhere until a sink is added. Console output is opt-in: `Logging.configure((b) => b.addSink(createConsoleSink()))`.
- A `Formatter` (`formatter.ts`) returns the argument list of one console call; `createConsoleSink` (`console-sink.ts`) owns the level-to-method routing (error/fatal -> error, warn -> warn, info -> info, trace/debug -> debug, never `console.trace`; ADR-0007 "Levels") and spreads the args. The logger keeps its own copy of the routing table because `./logger` and `./errors` do not import each other.
- A stdout or stream sink cannot consume a console-argument list (`%c` and style strings mean nothing to a stream); ADR-0018 records that it needs a different, string-only contract.
- `LogRecord.time` is epoch milliseconds as a number with a sub-millisecond fraction (`record.ts`); the JSON-lines formatter keeps it unchanged and the ANSI and browser formatters render UTC ISO text.
- Attributes reach every sink already normalized, redacted and frozen, so `JSON.stringify` needs no replacer.
