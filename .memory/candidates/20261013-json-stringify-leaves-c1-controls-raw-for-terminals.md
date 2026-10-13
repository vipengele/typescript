---
about: JSON.stringify escapes only U+0000-U+001F, so terminal output built from it still needs DEL and C1 controls made visible
saw:
  - source/core/packages/observability/src/logger/formatters/ansi.ts
  - source/core/packages/observability/src/logger/formatters/ansi.test.ts
---
- `JSON.stringify` leaves DEL (U+007F) and the C1 controls (U+0080-U+009F, including U+009B, a one-byte CSI that UTF-8 terminals honour) raw. The ANSI formatter therefore passes the stringified attributes and error `data` through `visible()` as well as message, category and error text, which turns every control character other than tab and newline into a lowercase `\uXXXX` escape.
- Newlines in the message or category are indented by two spaces on continuation lines so user text cannot start a line that reads as a record of its own.
