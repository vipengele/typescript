# @vipengele/ts-core-observability

Structured logging and error reporting for the browser and Node, as two entry points:

| Entry point | What it is |
|-------------|------------|
| `@vipengele/ts-core-observability/logger` | Category-scoped structured loggers with pluggable sinks and formatters |
| `@vipengele/ts-core-observability/errors` | An error reporter: capture, normalization, scopes, breadcrumbs and pluggable transports |

An application that only logs imports only `/logger` and bundles none of the reporter.

```sh
pnpm add @vipengele/ts-core-observability
```

Runs in the browser and in Node 24+. ESM only, side-effect free.
