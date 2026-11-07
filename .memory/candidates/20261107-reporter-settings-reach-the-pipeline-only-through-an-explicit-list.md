---
about: "a new ReporterSettings field does nothing until createReporter passes it to createCapture by name; pipeline tests that call createCapture directly stay green without it"
saw:
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/pipeline.ts
---
`createReporter` destructures the built `ReporterSettings` field by field and hands `createCapture`
an explicit object literal (`reporter.ts`, the `createCapture({` call). Any setting the builder
gains, such as `maxBreadcrumbs` or `beforeBreadcrumb`, must be added to both the destructuring and
that literal. If it is not, the `Pipeline` field is `undefined` and the pipeline's own default
applies silently. Pipeline unit tests construct `createCapture` with the field set, so they pass,
and type-check passes too, because every `Pipeline` field is optional. Only an end-to-end test
through `createReporter` (`reporter.test.ts`) catches the missing wire.
