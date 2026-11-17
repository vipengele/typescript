---
name: reporter-settings-reach-the-pipeline-through-an-explicit-list
kind: gotcha
description: A new ReporterSettings field does nothing until createReporter both destructures it and passes it to createCapture by name; pipeline unit tests and type-check stay green without it.
anchors:
  - path: source/core/packages/observability/src/errors/reporter.ts
    blob: c5a2b132e063
  - path: source/core/packages/observability/src/errors/pipeline.ts
    blob: 6192fe976ca6
confidence: verified
---

`createReporter` destructures the built `ReporterSettings` field by field
(`source/core/packages/observability/src/errors/reporter.ts:94-111`) and hands `createCapture` an
explicit object literal (`:113-129`). A setting the builder gains must be added to both lists.

If it is not, the `Pipeline` field is `undefined` and the pipeline's own default applies
silently. Pipeline unit tests construct `createCapture` directly with the field set, so they
pass; type-check passes too, because the `Pipeline` fields are optional. Only an end-to-end test
through `createReporter` catches the missing wire, so write one for every new setting.
