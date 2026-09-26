#!/usr/bin/env bash
# Verifies that every cross-project dependency (ADR-0009) has both halves: the
# exact pin in a package's `dependencies` and the `link:` override in its
# project's pnpm-workspace.yaml pointing at the owning package's directory.
#
# Usage: verify.sh [expect-version], run from the repository root.
#
# A package's owning project is the source/<project> directory its manifest sits
# under. A `dependencies` entry owned by another project is a pin: its value is
# a plain exact version (equal to expect-version when that is given), and the
# depending project overrides the name with a `link:` that resolves, relative to
# its pnpm-workspace.yaml, to the owning package's directory. An override whose
# name another project owns is dead unless some package in the overriding
# project pins it. Same-project dependencies (workspace:*) and overrides of
# names no project owns are not cross-project and are left alone. Every failure
# is reported before the script exits.
set -euo pipefail

expect_version="${1:-}"

shopt -s nullglob
manifests=(source/*/packages/*/package.json)
workspaces=(source/*/pnpm-workspace.yaml)
shopt -u nullglob

failures=0
fail() {
  echo "::error file=$1,title=Cross-project dependency::$2"
  failures=$((failures + 1))
}

# The directory a path resolves to, with symlinks and `..` removed; empty when
# it does not exist.
resolve_dir() {
  (cd "$1" 2>/dev/null && pwd -P) || true
}

# One line per cross-project pin:
# "<project>\t<manifest>\t<package>\t<dependency>\t<value>\t<owner project>\t<owner dir>".
pins=""
if ((${#manifests[@]} > 0)); then
  pins="$(jq -nr '
    [inputs | {
      project: (input_filename | split("/")[1]),
      manifest: input_filename,
      dir: (input_filename | rtrimstr("/package.json")),
      name,
      deps: (.dependencies // {})
    }] as $manifests
    | ($manifests | map({(.name): {project, dir}}) | add // {}) as $owner
    | $manifests[] as $m
    | $m.deps | to_entries[]
    | select($owner[.key] != null and $owner[.key].project != $m.project)
    | [$m.project, $m.manifest, $m.name, .key, .value, $owner[.key].project, $owner[.key].dir]
    | @tsv
  ' "${manifests[@]}")"
fi

# One line per package name a project owns: "<name>\t<owner project>".
owners=""
if ((${#manifests[@]} > 0)); then
  owners="$(jq -r '[.name, (input_filename | split("/")[1])] | @tsv' "${manifests[@]}")"
fi

# The overrides of a project's pnpm-workspace.yaml as a JSON object.
overrides_of() {
  local workspace="source/$1/pnpm-workspace.yaml"
  if [[ ! -f "$workspace" ]]; then
    echo '{}'
    return
  fi
  yq -o=json '.overrides // {}' "$workspace"
}

checked=0

while IFS=$'\t' read -r project manifest package dep value owner owner_dir; do
  [[ -n "$project" ]] || continue
  checked=$((checked + 1))
  workspace="source/${project}/pnpm-workspace.yaml"
  label="${package} (source/${project}) depends on ${dep} (source/${owner})"

  if [[ ! "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    fail "$manifest" "${label} as \"${value}\"; a cross-project dependency is an exact version"
  elif [[ -n "$expect_version" && "$value" != "$expect_version" ]]; then
    fail "$manifest" "${label} at ${value}; expected ${expect_version}"
  fi

  if [[ ! -f "$workspace" ]]; then
    fail "$manifest" "${label}, but ${workspace} does not exist to override it with a link: to ${owner_dir}"
    continue
  fi

  if ! overrides="$(overrides_of "$project")"; then
    fail "$workspace" "Could not read the overrides of ${workspace}"
    continue
  fi
  link="$(jq -r --arg dep "$dep" '.[$dep] // empty | strings' <<< "$overrides")"

  if [[ -z "$link" ]]; then
    fail "$workspace" "${label}, but ${workspace} has no override for ${dep}; expected \"link:<path to ${owner_dir}>\""
    continue
  fi
  if [[ "$link" != link:* ]]; then
    fail "$workspace" "${workspace} overrides ${dep} with \"${link}\"; expected \"link:<path to ${owner_dir}>\""
    continue
  fi

  target="$(resolve_dir "source/${project}/${link#link:}")"
  if [[ -z "$target" || "$target" != "$(resolve_dir "$owner_dir")" ]]; then
    fail "$workspace" "${workspace} overrides ${dep} with \"${link}\", which does not resolve to ${owner_dir}"
  fi
done <<< "$pins"

for workspace in "${workspaces[@]}"; do
  project="$(cut -d/ -f2 <<< "$workspace")"
  if ! overrides="$(overrides_of "$project")"; then
    fail "$workspace" "Could not read the overrides of ${workspace}"
    continue
  fi
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    owner="$(awk -F'\t' -v n="$name" '$1 == n { print $2; exit }' <<< "$owners")"
    [[ -n "$owner" && "$owner" != "$project" ]] || continue
    checked=$((checked + 1))
    if ! awk -F'\t' -v p="$project" -v n="$name" '$1 == p && $4 == n { found = 1 } END { exit !found }' <<< "$pins"; then
      fail "$workspace" "${workspace} overrides ${name} (source/${owner}), but no package in source/${project} names it in its dependencies"
    fi
  done < <(jq -r 'keys[]' <<< "$overrides")
done

if ((failures > 0)); then
  echo "${failures} cross-project dependency problem(s) found"
  exit 1
fi

if ((checked == 0)); then
  echo "no cross-project dependencies or overrides; nothing to verify"
else
  echo "every cross-project dependency is an exact pin with a matching link: override"
fi
