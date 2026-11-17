---
name: json-stringify-leaves-del-and-c1-controls-raw
kind: gotcha
description: JSON.stringify escapes only U+0000-U+001F, so the ANSI formatter passes stringified attributes and error data through visible() to neutralise DEL and C1 controls such as the one-byte CSI U+009B.
anchors:
  - path: source/core/packages/observability/src/logger/formatters/ansi.ts
    blob: 80be380a8c06
confidence: verified
---

`JSON.stringify` leaves DEL (U+007F) and the C1 controls (U+0080-U+009F) raw. U+009B is a one-byte
CSI that UTF-8 terminals honour, so stringified user data can still drive the terminal. In
`source/core/packages/observability/src/logger/formatters/ansi.ts` the control test covers
`0x7f..0x9f` (`:42`) and `visible()` (`:50`) is applied to the output of `JSON.stringify` for
attributes (`:132`) and error `data` (`:93`), not only to message, category and error text
(`:88-90,129-130`).

Terminal output built from `JSON.stringify` without that pass is not safe.
