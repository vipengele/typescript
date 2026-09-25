---
name: release
description: >-
  Use this skill when the user asks to release, publish, cut or tag a version of
  this repo (e.g. "release 0.2.0", "cut a patch", "publish the framework").
  Covers choosing the version, setting it in every project, writing the release
  notes, tagging, and verifying what the release workflow published to npm.
---

# Release the framework

A release is one tag: `vX.Y.Z`. It publishes **every non-private package of every project** under
`source/` at that version, projects in dependency order, then creates the GitHub Release
(ADR-0001).

There is no changesets and no release-please. The tag is the only input, and a human pushes it.

## 1 — Decide the version

Every package in every project moves to the same version. Read `git log` since the last `v*` tag
and pick the bump from the Conventional Commit types across the whole repo: a `!` or
`BREAKING CHANGE` is major, `feat` is minor, anything else is patch. While the framework is
pre-1.0, a breaking change is a minor bump.

## 2 — Set the version in every project

```bash
for project in source/*/; do
  (cd "$project" && pnpm -r exec npm version <version> --no-git-tag-version)
done
```

The release workflow refuses a tag whose version not every publishable manifest carries, in any
project, so this and the tag have to agree exactly.

## 3 — Pin cross-project dependencies to the new version

Step 2 moves each package's own `version`, not the pins other projects hold on it. A cross-project
dependency is an exact pin (ADR-0009), so every `dependencies` entry naming a package another
project owns has to be rewritten to the new version too, or the release publishes a dependent that
names the previous release. The release workflow's version check covers those pins and refuses the
tag if one is left behind.

A package's owning project is the `source/<project>` its manifest sits under — the same map
`build-cross-project-deps`, `verify-cross-project-deps` and `changed-projects` under
`.github/actions/` build. A dependency owned by the same project is a `workspace:*` link and is
never touched.

```bash
owners="$(jq -n '[inputs | {(.name): (input_filename | split("/")[1])}] | add // {}' \
  source/*/packages/*/package.json)"

rewritten=()
for manifest in source/*/packages/*/package.json; do
  project="$(echo "$manifest" | cut -d/ -f2)"
  updated="$(jq --argjson owner "$owners" --arg project "$project" --arg version "<version>" '
    if .dependencies then
      .dependencies |= with_entries(
        if $owner[.key] != null and $owner[.key] != $project then .value = $version else . end)
    else . end' "$manifest")"
  if [[ "$updated" != "$(jq . "$manifest")" ]]; then
    printf '%s\n' "$updated" > "$manifest"
    rewritten+=("$project")
  fi
done

for project in $(printf '%s\n' "${rewritten[@]}" | sort -u); do
  (cd "source/$project" && pnpm install --lockfile-only)
done
```

Refresh the lockfile of every project whose manifests were rewritten, before anything commits, and
commit it with the pins in the same `build: release <version>` change. The lockfile records the
pin's `link:` override rather than the pin, so for a pin with its override the refresh changes
nothing. For a pin without one, the refresh is what fails, here, with `ERR_PNPM_NO_MATCHING_VERSION`
— the new version is not on the registry yet — rather than on the release pull request or at
publish. A project with no cross-project dependency needs no refresh.

No project has a cross-project dependency yet, so this step rewrites nothing and refreshes no
lockfile. Run it anyway: it is a no-op until the first pin exists, and the release that follows
that pin is the one that cannot skip it.

## 4 — Write the release notes

`docs/release-notes/v<version>.md`, at the repo root. **The workflow fails without it**, before it
publishes anything, because the GitHub Release body is a file a human wrote and reviewed.

Group the notes by project and package. Say what changed and what a consumer has to do about it. A
breaking change names the old and new spelling; "various fixes" is not release notes. A package
with no change says so in one line rather than being left out.

## 5 — Open it as a pull request, and merge it

The version bump, the cross-project pins with their lockfiles, and the notes are an ordinary
change: `build: release <version>` as the subject. Nothing publishes on merge.

## 6 — Tag the merged commit

```bash
git fetch origin
git tag v<version> origin/main
git push origin v<version>
```

The tag must point at the merged commit, not at the branch.

## 7 — Watch it

```bash
gh run list --workflow release --limit 3
gh run watch <run-id>
```

The jobs are `tag` (validates the tag and the notes, prints the publish order), `build` (one
credential-free leg per project), `publish` (npm trusted publishing with provenance, one project at
a time, dependencies first) and `announce` (the GitHub Release). A publish is idempotent: it probes
the registry per package and publishes only what is absent, so a re-run finishes a partial release
rather than failing on what already landed.

## 8 — Verify

```bash
npm view @vipengele/<package> version
gh release view v<version>
```

## When a package name is new

npm can only enrol a trusted publisher on a name the registry already holds, so a brand-new
package name has to be created by a one-time manual publish of a `0.0.0` placeholder with a token
before the workflow can ever publish it. That is a deliberate, irreversible act — a published name
and version cannot be reused — so ask the user to run it, and do not publish on their behalf
without them saying so explicitly in that moment.

After the name exists, the user enrols the trusted publisher on npm against this repository, the
`release.yml` workflow file and the `npm-release` environment.
