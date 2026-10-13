---
about: a console reads its first string argument as a format string, so a formatter must keep user text out of that slot
saw:
  - source/core/packages/observability/src/logger/formatters/json-lines.ts
  - source/core/packages/observability/src/logger/formatters/ansi.ts
  - source/core/packages/observability/src/logger/formatters/browser.ts
  - source/core/packages/observability/src/logger/formatters/browser.browser.test.ts
---
- Browser and Node consoles consume `%s %d %i %f %o %O %c %j` in the first string argument, so a message such as `disk 95%d full` is mangled or swallows the next argument. JSON lines and ANSI return `["%s", text]`; the browser formatter builds a `%c` format string and escapes every `%` in the time, level and category as `%%` so the three style arguments stay aligned with the three `%c` directives. Later arguments (message, attributes, error) are not read as format strings.
- The Chromium test can only check what the console receives, not what DevTools prints.
