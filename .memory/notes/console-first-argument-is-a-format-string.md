---
name: console-first-argument-is-a-format-string
kind: gotcha
description: A console treats its first string argument as a format string, so every logger Formatter keeps user text out of that slot or escapes % in it.
anchors:
  - path: source/core/packages/observability/src/logger/formatters/*.ts
    matches:
      - path: source/core/packages/observability/src/logger/formatters/ansi.test.ts
        blob: 395ef9a4695b
      - path: source/core/packages/observability/src/logger/formatters/ansi.ts
        blob: 80be380a8c06
      - path: source/core/packages/observability/src/logger/formatters/browser.browser.test.ts
        blob: 6cc25938d58b
      - path: source/core/packages/observability/src/logger/formatters/browser.test.ts
        blob: 4a9c94999d41
      - path: source/core/packages/observability/src/logger/formatters/browser.ts
        blob: cb4262422b2d
      - path: source/core/packages/observability/src/logger/formatters/json-lines.test.ts
        blob: 6053f0029592
      - path: source/core/packages/observability/src/logger/formatters/json-lines.ts
        blob: 6d77625d66a9
      - path: source/core/packages/observability/src/logger/formatters/select.test.ts
        blob: d0a94719e7ec
      - path: source/core/packages/observability/src/logger/formatters/select.ts
        blob: 1a1567e24156
confidence: verified
---

Browser and Node consoles consume `%s %d %i %f %o %O %c %j` in the first string argument, so a
message such as `disk 95%d full` passed first is mangled or swallows the next argument. Every
formatter in `source/core/packages/observability/src/logger/formatters/` guards against it:

- JSON lines and ANSI return `["%s", line]` (`json-lines.ts:50`, `ansi.ts:137`).
- The browser formatter builds a `%c` format string and escapes every `%` in time, level and
  category as `%%` (`browser.ts:30,48`), so its three style arguments stay aligned with the three
  `%c` directives. The message follows as its own argument and needs no escaping.

A new formatter that returns user text as element 0 reintroduces the bug; no type catches it.
