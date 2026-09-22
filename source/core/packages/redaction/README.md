# @vipengele/ts-core-redaction

Removes secrets and personal data from structured values before they are logged, reported or
sent anywhere: rules match keys and value patterns, and depth and size limits bound what is
walked. Usable on its own, and the redaction layer of `@vipengele/ts-core-observability`.

```sh
pnpm add @vipengele/ts-core-redaction
```

Runs in the browser and in Node 24+. ESM only, side-effect free.
